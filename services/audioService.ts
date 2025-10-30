/**
 * Writes a string to a DataView.
 * @param view The DataView to write to.
 * @param offset The offset to start writing at.
 * @param str The string to write.
 */
function writeString(view: DataView, offset: number, str: string) {
    for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
    }
}

/**
 * Converts an AudioBuffer to a WAV audio Blob.
 * This function handles mono and stereo audio.
 * @param buffer The AudioBuffer to convert.
 * @returns A Blob containing the WAV audio data.
 */
export const bufferToWave = (buffer: AudioBuffer): Blob => {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const numSamples = buffer.length;
    const bitsPerSample = 16;
    const blockAlign = numChannels * (bitsPerSample / 8);
    const byteRate = sampleRate * blockAlign;
    const dataSize = numSamples * blockAlign;
    const bufferSize = 44 + dataSize;

    const arrayBuffer = new ArrayBuffer(bufferSize);
    const view = new DataView(arrayBuffer);

    let offset = 0;

    // RIFF header
    writeString(view, offset, 'RIFF'); offset += 4;
    view.setUint32(offset, 36 + dataSize, true); offset += 4;
    writeString(view, offset, 'WAVE'); offset += 4;

    // fmt chunk
    writeString(view, offset, 'fmt '); offset += 4;
    view.setUint32(offset, 16, true); offset += 4; // Sub-chunk size
    view.setUint16(offset, 1, true); offset += 2; // PCM audio format
    view.setUint16(offset, numChannels, true); offset += 2;
    view.setUint32(offset, sampleRate, true); offset += 4;
    view.setUint32(offset, byteRate, true); offset += 4;
    view.setUint16(offset, blockAlign, true); offset += 2;
    view.setUint16(offset, bitsPerSample, true); offset += 2;

    // data chunk
    writeString(view, offset, 'data'); offset += 4;
    view.setUint32(offset, dataSize, true); offset += 4;

    // Write PCM data
    const channels = [];
    for (let i = 0; i < numChannels; i++) {
        channels.push(buffer.getChannelData(i));
    }

    for (let i = 0; i < numSamples; i++) {
        for (let j = 0; j < numChannels; j++) {
            const sample = Math.max(-1, Math.min(1, channels[j][i]));
            view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
            offset += 2;
        }
    }

    return new Blob([view], { type: 'audio/wav' });
};


/**
 * Normalizes an AudioBuffer to a target peak level.
 * @param buffer The AudioBuffer to normalize.
 * @param audioContext The AudioContext to use for creating the new buffer.
 * @returns A new, normalized AudioBuffer.
 */
export const normalizeAudioBuffer = (buffer: AudioBuffer, audioContext: AudioContext): AudioBuffer => {
    const numberOfChannels = buffer.numberOfChannels;
    const length = buffer.length;
    const sampleRate = buffer.sampleRate;

    let maxPeak = 0;
    // Find the absolute maximum peak in the buffer
    for (let channel = 0; channel < numberOfChannels; channel++) {
        const channelData = buffer.getChannelData(channel);
        for (let i = 0; i < length; i++) {
            const peak = Math.abs(channelData[i]);
            if (peak > maxPeak) {
                maxPeak = peak;
            }
        }
    }

    if (maxPeak === 0) {
        return buffer; // It's silent, no need to normalize
    }

    const targetPeak = 0.98; // Target peak at ~ -0.17 dBFS to avoid clipping
    const gain = targetPeak / maxPeak;

    const normalizedBuffer = audioContext.createBuffer(
        numberOfChannels,
        length,
        sampleRate
    );

    for (let channel = 0; channel < numberOfChannels; channel++) {
        const inputData = buffer.getChannelData(channel);
        const outputData = normalizedBuffer.getChannelData(channel);
        for (let i = 0; i < length; i++) {
            outputData[i] = inputData[i] * gain;
        }
    }

    return normalizedBuffer;
};


/**
 * Mixes a voice-over track with a background music track, applying a "ducking" effect.
 * This version eliminates audio peaks/clicks by creating a smooth, continuous volume envelope.
 * It supports an intro, restores music volume during long silences, and adds a precise outro.
 * @param voiceBuffer The AudioBuffer for the voice-over.
 * @param musicBuffer The AudioBuffer for the background music.
 * @param audioContext The AudioContext, used for creating an OfflineAudioContext.
 * @returns A Promise that resolves to the mixed AudioBuffer.
 */
export const mixWithDucking = async (
    voiceBuffer: AudioBuffer,
    musicBuffer: AudioBuffer,
    audioContext: AudioContext
): Promise<AudioBuffer> => {
    // Parameters for ducking
    const duckingAmount = 0.2; // Reduce music to 20% of its volume
    const normalVolume = 1.0;
    const attackTime = 0.2; // Time to reduce volume
    const releaseTime = 0.8; // Time to restore volume
    const longSilenceThreshold = 5.0; // Seconds for a long silence
    const voiceBoostAmount = 1.4; // Boost voice by ~3dB for clarity

    // Parameters for speech detection
    const threshold = 0.01; // Amplitude threshold to detect speech
    const analysisWindowSize = 1024; // Samples to analyze at a time
    const speechHoldTime = 0.3; // Seconds to hold 'speech' state to bridge gaps

    // Parameters for Outro
    const postSpeechPadding = 3.0; // Final file is 3s longer than voice-over
    const fadeOutDuration = 5.0; // Final fade-out lasts 5s

    const finalDuration = voiceBuffer.duration + postSpeechPadding;
    const numberOfChannels = Math.min(2, Math.max(voiceBuffer.numberOfChannels, musicBuffer.numberOfChannels));
    const sampleRate = voiceBuffer.sampleRate;

    const offlineContext = new OfflineAudioContext(
        numberOfChannels,
        Math.ceil(finalDuration * sampleRate),
        sampleRate
    );

    const voiceSource = offlineContext.createBufferSource();
    voiceSource.buffer = voiceBuffer;
    const voiceGain = offlineContext.createGain();
    voiceGain.gain.value = voiceBoostAmount;

    const musicSource = offlineContext.createBufferSource();
    musicSource.buffer = musicBuffer;
    musicSource.loop = true;
    const musicGain = offlineContext.createGain();

    voiceSource.connect(voiceGain);
    voiceGain.connect(offlineContext.destination);
    musicSource.connect(musicGain);
    musicGain.connect(offlineContext.destination);

    // --- Speech Segment Detection ---
    const voiceData = voiceBuffer.getChannelData(0);
    const speechSegments: { start: number; end: number }[] = [];
    let currentSegment: { start: number; end: number } | null = null;
    let lastSpeechTime = -1;

    for (let i = 0; i < voiceData.length; i += analysisWindowSize) {
        const currentTime = i / sampleRate;
        const windowEnd = Math.min(i + analysisWindowSize, voiceData.length);
        let maxAmplitudeInWindow = 0;
        for (let j = i; j < windowEnd; j++) {
            maxAmplitudeInWindow = Math.max(maxAmplitudeInWindow, Math.abs(voiceData[j]));
        }

        const isSpeech = maxAmplitudeInWindow > threshold;

        if (isSpeech) {
            const segmentEndTime = currentTime + (analysisWindowSize / sampleRate);
            lastSpeechTime = segmentEndTime;
            if (!currentSegment) {
                currentSegment = { start: currentTime, end: segmentEndTime };
            } else {
                currentSegment.end = segmentEndTime;
            }
        } else {
            if (currentSegment && currentTime > lastSpeechTime + speechHoldTime) {
                speechSegments.push(currentSegment);
                currentSegment = null;
            }
        }
    }
    if (currentSegment) {
        speechSegments.push(currentSegment);
    }

    // --- Generate Volume Envelope ---
    const gain = musicGain.gain;
    gain.setValueAtTime(normalVolume, 0); // Start at full volume

    if (speechSegments.length === 0) {
        // No speech, just fade out at the end
        const fadeOutStartTime = Math.max(0, finalDuration - fadeOutDuration);
        gain.setValueAtTime(normalVolume, fadeOutStartTime);
        gain.linearRampToValueAtTime(0.001, finalDuration);
    } else {
        // --- Intro ---
        const firstSegment = speechSegments[0];
        const introRampDownTime = Math.max(0, firstSegment.start - attackTime);
        gain.setValueAtTime(normalVolume, introRampDownTime);
        gain.linearRampToValueAtTime(duckingAmount, firstSegment.start);

        // --- Inter-segment silences ---
        for (let i = 0; i < speechSegments.length - 1; i++) {
            const current = speechSegments[i];
            const next = speechSegments[i + 1];
            const silenceStartTime = current.end;
            const silenceEndTime = next.start;
            const silenceDuration = silenceEndTime - silenceStartTime;

            if (silenceDuration >= longSilenceThreshold) {
                // Long silence: ramp up, hold, then ramp down
                const rampUpTime = silenceStartTime + releaseTime;
                gain.linearRampToValueAtTime(normalVolume, rampUpTime);

                const rampDownTime = silenceEndTime - attackTime;
                gain.setValueAtTime(normalVolume, rampDownTime);
                gain.linearRampToValueAtTime(duckingAmount, silenceEndTime);
            }
        }

        // --- Final Outro ---
        const lastSegment = speechSegments[speechSegments.length - 1];
        const restoreStartTime = lastSegment.end;
        const restoreEndTime = restoreStartTime + releaseTime;
        const fadeOutStartTime = Math.max(0, finalDuration - fadeOutDuration);

        // Check for overlap between volume restoration and final fade
        if (fadeOutStartTime >= restoreEndTime) {
            // No overlap: restore fully, hold, then fade.
            gain.linearRampToValueAtTime(normalVolume, restoreEndTime);
            gain.setValueAtTime(normalVolume, fadeOutStartTime);
            gain.linearRampToValueAtTime(0.001, finalDuration);
        } else {
            // Overlap: fade starts during or before restoration.
            if (fadeOutStartTime <= restoreStartTime) {
                // Fade starts before restoration begins: just fade from the ducked amount.
                 gain.setValueAtTime(duckingAmount, fadeOutStartTime);
                 gain.linearRampToValueAtTime(0.001, finalDuration);
            } else {
                // Fade starts *during* restoration: calculate intermediate volume and ramp from there.
                const rampProgress = (fadeOutStartTime - restoreStartTime) / releaseTime;
                const volumeAtFadeStart = duckingAmount + (normalVolume - duckingAmount) * rampProgress;
                
                gain.linearRampToValueAtTime(volumeAtFadeStart, fadeOutStartTime);
                gain.linearRampToValueAtTime(0.001, finalDuration);
            }
        }
    }

    // Start sources and render
    voiceSource.start(0);
    musicSource.start(0);

    return offlineContext.startRendering();
};