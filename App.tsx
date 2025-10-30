import React, { useState, useRef, useEffect } from 'react';
import { bufferToWave, mixWithDucking, normalizeAudioBuffer } from './services/audioService';
import {
    MusicIcon,
    LoadingIcon,
    CheckCircleIcon,
    ErrorIcon,
    UploadIcon,
    SpeakerIcon,
} from './components/Icons';

const App: React.FC = () => {
    const [voiceFile, setVoiceFile] = useState<File | null>(null);
    const [backgroundMusicFile, setBackgroundMusicFile] = useState<File | null>(null);
    const [generatedAudioUrl, setGeneratedAudioUrl] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [statusMessage, setStatusMessage] = useState('');

    const audioContextRef = useRef<AudioContext | null>(null);

    // Clean up object URL on unmount or when a new one is generated
    useEffect(() => {
        return () => {
            if (generatedAudioUrl) {
                URL.revokeObjectURL(generatedAudioUrl);
            }
        };
    }, [generatedAudioUrl]);

    // Lazily create AudioContext
    const getAudioContext = (): AudioContext => {
        if (!audioContextRef.current) {
            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        return audioContextRef.current;
    };

    const handleFileChange = (
        event: React.ChangeEvent<HTMLInputElement>,
        setFile: React.Dispatch<React.SetStateAction<File | null>>
    ) => {
        const file = event.target.files?.[0];
        if (file) {
            if (file.type.startsWith('audio/')) {
                setFile(file);
                setError(null);
            } else {
                setFile(null);
                setError('Please upload a valid audio file.');
            }
        }
    };

    const handleMix = async () => {
        if (!voiceFile || !backgroundMusicFile) {
            setError("Please upload both a voice-over file and a background music file.");
            return;
        }

        setIsLoading(true);
        setError(null);
        if (generatedAudioUrl) URL.revokeObjectURL(generatedAudioUrl);
        setGeneratedAudioUrl(null);

        try {
            setStatusMessage('Initializing audio context...');
            const audioContext = getAudioContext();

            setStatusMessage('Decoding voice-over file...');
            const voiceArrayBuffer = await voiceFile.arrayBuffer();
            const voiceAudioBuffer = await audioContext.decodeAudioData(voiceArrayBuffer);

            setStatusMessage('Decoding background music file...');
            const musicArrayBuffer = await backgroundMusicFile.arrayBuffer();
            const backgroundAudioBuffer = await audioContext.decodeAudioData(musicArrayBuffer);

            setStatusMessage('Mixing audio with ducking effect...');
            const finalAudioBuffer = await mixWithDucking(voiceAudioBuffer, backgroundAudioBuffer, audioContext);

            setStatusMessage('Normalizing final audio...');
            const normalizedBuffer = normalizeAudioBuffer(finalAudioBuffer, audioContext);

            setStatusMessage('Encoding final audio to WAV...');
            const audioBlob = bufferToWave(normalizedBuffer);
            setGeneratedAudioUrl(URL.createObjectURL(audioBlob));
            setStatusMessage('Done!');

        } catch (e: any) {
            console.error(e);
            setError(`An error occurred during mixing: ${e.message}. Please ensure the audio files are not corrupted.`);
        } finally {
            setIsLoading(false);
            setStatusMessage('');
        }
    };

    const renderFileUpload = (
        title: string,
        icon: React.ReactNode,
        file: File | null,
        onFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void,
        id: string
    ) => (
        <section className="bg-gray-800 p-6 rounded-lg shadow-lg">
            <h2 className="text-2xl font-semibold mb-4 flex items-center">
                {icon} {title}
            </h2>
            <label htmlFor={id} className="w-full flex flex-col items-center justify-center p-6 border-2 border-dashed border-gray-600 rounded-lg cursor-pointer hover:bg-gray-700 transition-colors">
                <UploadIcon className="w-8 h-8 mb-2 text-gray-500" />
                <span className="text-gray-400 text-center break-all">
                    {file ? file.name : 'Click to upload audio file'}
                </span>
                <input id={id} type="file" className="hidden" onChange={onFileChange} accept="audio/*" />
            </label>
        </section>
    );

    return (
        <div className="bg-gray-900 text-white min-h-screen font-sans">
            <div className="container mx-auto p-4 md:p-8 max-w-2xl">
                <header className="text-center mb-8">
                    <h1 className="text-4xl md:text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-600">
                        Podcast Audio Mixer
                    </h1>
                    <p className="text-gray-400 mt-2">
                        Combine your voice-over with background music, with automatic volume adjustment.
                    </p>
                </header>

                <main className="space-y-8">
                    {renderFileUpload(
                        '1. Upload Voice-over',
                        <SpeakerIcon className="w-6 h-6 mr-2" />,
                        voiceFile,
                        (e) => handleFileChange(e, setVoiceFile),
                        'voice-upload'
                    )}

                    {renderFileUpload(
                        '2. Upload Background Music',
                        <MusicIcon className="w-6 h-6 mr-2" />,
                        backgroundMusicFile,
                        (e) => handleFileChange(e, setBackgroundMusicFile),
                        'music-upload'
                    )}
                    
                    <section className="bg-gray-800 p-6 rounded-lg shadow-lg">
                         <button
                            onClick={handleMix}
                            disabled={isLoading || !voiceFile || !backgroundMusicFile}
                            className="w-full text-lg font-bold py-3 px-6 bg-gradient-to-r from-green-400 to-blue-500 hover:from-green-500 hover:to-blue-600 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center transition-all"
                        >
                            {isLoading ? (
                                <>
                                    <LoadingIcon className="w-6 h-6 mr-3 animate-spin" />
                                    <span>{statusMessage || 'Mixing...'}</span>
                                </>
                            ) : (
                                'Mix Audio'
                            )}
                        </button>

                        {error && (
                            <div className="mt-4 p-3 bg-red-900/50 text-red-300 border border-red-700 rounded-md flex items-center">
                                <ErrorIcon className="w-5 h-5 mr-2 flex-shrink-0" />
                                <span>{error}</span>
                            </div>
                        )}

                        {generatedAudioUrl && !isLoading && (
                            <div className="mt-6">
                                <div className="mb-3 p-3 bg-green-900/50 text-green-300 border border-green-700 rounded-md flex items-center">
                                    <CheckCircleIcon className="w-5 h-5 mr-2 flex-shrink-0" />
                                    <span>Mixing complete!</span>
                                </div>
                                <audio controls src={generatedAudioUrl} className="w-full">
                                    Your browser does not support the audio element.
                                </audio>
                            </div>
                        )}
                    </section>
                </main>
            </div>
        </div>
    );
};

export default App;