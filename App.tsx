/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/


import React, { useCallback, useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { ShaderCanvas } from './components/ShaderCanvas';
import { ControlsPanel } from './components/ControlsPanel';
import { DpadControls } from './components/DpadControls';
import { Hud } from './components/Hud';
import { ShipOverlay } from './components/ShipOverlay';
import { CombatOverlay } from './components/CombatOverlay';
import { AppProvider, useAppContext } from './context/AppContext';
import { useAppStoreComplete } from './hooks/useAppStore';
import { GearIcon, SpeakerWaveIcon, SpeakerXMarkIcon, RocketLaunchIcon } from './components/Icons';
import { SHOW_SETTINGS_BUTTON, SHOW_SHARE_BUTTON, SHOW_HUD_BUTTON, SHOW_MUTE_BUTTON } from './config';

// Optimization: Define static constant outside component to avoid recreation every render
const NAV_KEYS = ['w', 'a', 's', 'd', ' ', 'shift', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];

const AppContent: React.FC = () => {
    const {
        canvasSize,
        sliders,
        uniforms,
        currentSessionId,
        activeShaderCode,
        allUniforms,
        renderCameraRef, // Use renderCameraRef for offset support
        cameraControlsEnabled,
        setIsControlsOpen,
        isHdEnabled,
        setIsHdEnabled,
        isFpsEnabled,
        EDITMODE,
        isMoving,
        isInteracting,
        pressedKeys,
        viewMode,
        setViewMode,
        viewModeTransition,
        fileInputRef,
        handleFileChange,
        soundConfig,
        handleSoundConfigChange,
    } = useAppContext();

    const [isLinkCopied, setIsLinkCopied] = useState(false);
    const [currentTime, setCurrentTime] = useState('');

    useEffect(() => {
        const updateClock = () => {
            const now = new Date();
            setCurrentTime(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
        };
        updateClock();
        const interval = setInterval(updateClock, 10000);
        return () => clearInterval(interval);
    }, []);

    const handleShareClick = useCallback(() => {
        const params: Record<string, string | number> = {
            planet: currentSessionId,
            canvasSize,
        };

        sliders.forEach(slider => {
            const value = uniforms[slider.variableName];
            if (typeof value === 'number') {
                params[slider.variableName] = Number(value.toFixed(3));
            }
        });

        const hashString = Object.entries(params)
            .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
            .join('&');
        
        const url = `${window.location.origin}${window.location.pathname}#${hashString}`;

        navigator.clipboard.writeText(url).then(() => {
            setIsLinkCopied(true);
            setTimeout(() => {
                setIsLinkCopied(false);
            }, 2000); // Reset after 2 seconds
        }).catch(err => {
            console.error('Failed to copy link: ', err);
        });
    }, [currentSessionId, canvasSize, sliders, uniforms]);

    // Binary Volume Toggle
    const handleVolumeToggle = useCallback(() => {
        if (!soundConfig.enabled) {
             // Off -> On
            handleSoundConfigChange('enabled', true);
            handleSoundConfigChange('masterVolume', 0.5);
        } else {
            // On -> Off (Instant)
            handleSoundConfigChange('enabled', false);
        }
    }, [soundConfig.enabled, handleSoundConfigChange]);

    const canvasContainerStyle: React.CSSProperties = {};

    if (canvasSize === '100%_square') {
        canvasContainerStyle.width = '100%';
        canvasContainerStyle.aspectRatio = '1 / 1';
        // Force height auto so aspect ratio controls the height
        canvasContainerStyle.height = 'auto';
    } else if (canvasSize === '100%_height_square') {
        canvasContainerStyle.height = '100%';
        canvasContainerStyle.width = 'auto';
        canvasContainerStyle.aspectRatio = '1 / 1';
        // Center horizontally
        canvasContainerStyle.margin = '0 auto';
    } else if (canvasSize === 'fit_screen_square') {
        // Best fit: Use the smaller of width (100%) or available height (100vh - header buffer)
        // This ensures the square fits in the viewport regardless of orientation
        canvasContainerStyle.width = 'min(100%, 100vh - 100px)';
        canvasContainerStyle.height = 'auto';
        canvasContainerStyle.aspectRatio = '1 / 1';
    } else if (canvasSize === '100%') {
        canvasContainerStyle.width = '100%';
        canvasContainerStyle.height = '100%';
    } else { // '1024px', '512px', etc.
        canvasContainerStyle.width = canvasSize;
        canvasContainerStyle.height = canvasSize;
        canvasContainerStyle.aspectRatio = '1 / 1';
    }

    const handleShaderError = useCallback(() => {
        // This function is passed to the ShaderCanvas component.
        // It's wrapped in useCallback to ensure its reference stability.
    }, []);

    // Determine if we should drop quality for performance.
    const isNavigating = NAV_KEYS.some(key => pressedKeys.has(key));
    const shouldReduceQuality = isMoving || isInteracting || isNavigating;

    const toggleViewMode = () => {
        setViewMode(viewMode === 'cockpit' ? 'chase' : 'cockpit');
    };

    const getVolumeIcon = () => {
        if (!soundConfig.enabled) return <SpeakerXMarkIcon className="w-6 h-6" />;
        return <SpeakerWaveIcon className="w-6 h-6" />;
    }

    return (
        <div className="h-screen w-screen bg-gray-900 text-white flex flex-col overflow-hidden relative">
             {/* Android App Status Bar */}
             <div className="w-full bg-black/95 border-b border-white/5 px-4 py-1.5 flex justify-between items-center text-[10px] font-mono tracking-widest text-gray-400 select-none z-40 relative">
                 <div className="flex items-center gap-1.5 font-bold text-gray-300">
                     <span className="text-cyan-400 animate-pulse">●</span>
                     <span className="tracking-[0.15em] text-cyan-200">craftwarz</span>
                     <span className="text-gray-700">|</span>
                     <span className="text-[8px] text-gray-500 font-sans font-light tracking-wide uppercase">By the TUCCICYBERNATION</span>
                 </div>
                 <div className="flex items-center gap-2 text-gray-400">
                     <span className="text-[9px] text-teal-400">5G 📶</span>
                     <span className="text-cyan-400">99% 🔋</span>
                     <span className="text-gray-200 font-black tracking-normal">{currentTime}</span>
                 </div>
             </div>

             {/* Hidden input for file importing */}
            <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                className="hidden"
                accept=".json"
            />
            
            <main className={`flex-grow bg-black flex items-center justify-center overflow-hidden`}>
                <div
                    className="relative"
                    style={{ ...canvasContainerStyle, maxWidth: '100%', maxHeight: '100%' }}
                >
                    {activeShaderCode && (
                        <ShaderCanvas
                            key={activeShaderCode}
                            fragmentSrc={activeShaderCode}
                            onError={handleShaderError}
                            uniforms={allUniforms}
                            cameraRef={renderCameraRef} // Use the render-specific camera ref
                            isHdEnabled={isHdEnabled}
                            isFpsEnabled={isFpsEnabled}
                            isPlaying={true}
                            shouldReduceQuality={shouldReduceQuality}
                        />
                    )}
                    <ShipOverlay />
                    <CombatOverlay />
                </div>
            </main>
            
            <Hud />
            
            <ControlsPanel />
            {cameraControlsEnabled && <DpadControls />}

            {/* Android Bottom Home Bar Pill */}
            <div className="fixed bottom-1.5 left-1/2 -translate-x-1/2 w-28 h-1 bg-white/20 rounded-full z-40 pointer-events-none" />
            
            {/* Top Left Buttons Group: HD & Ship */}
            <div className="fixed top-12 left-4 z-30 flex flex-col gap-2">
                <button
                    onClick={() => setIsHdEnabled(!isHdEnabled)}
                    className={`w-12 h-12 flex items-center justify-center rounded-full transition-all transform hover:scale-110 shadow-lg border backdrop-blur-sm
                                ${isHdEnabled ? 'bg-white/90 text-black border-gray-300' : 'bg-gray-500/30 text-white border-white/20'}`}
                    aria-label={`Toggle HD Mode (${isHdEnabled ? 'On' : 'Off'})`}
                    title={`HD Mode (${isHdEnabled ? 'On' : 'Off'})`}
                >
                    <span className="font-bold text-sm">HD</span>
                </button>
                
                 {cameraControlsEnabled && SHOW_HUD_BUTTON && (
                    <button
                        onClick={toggleViewMode}
                        className={`w-12 h-12 flex items-center justify-center rounded-full transition-all transform hover:scale-110 shadow-lg border backdrop-blur-sm
                                    ${viewMode === 'chase' ? 'bg-white/90 text-black border-gray-300' : 'bg-gray-500/30 text-white border-white/20'}`}
                        aria-label={`Toggle View Mode (Current: ${viewMode})`}
                        title={viewMode === 'chase' ? "Switch to Cockpit View" : "Switch to Chase View"}
                    >
                       <RocketLaunchIcon className="w-6 h-6" />
                    </button>
                )}
            </div>

            {/* Top Right Buttons Group: Settings & Sound */}
            <div className="fixed top-12 right-4 z-30 flex flex-col gap-2">
                {SHOW_SETTINGS_BUTTON && (
                    <button
                        onClick={() => setIsControlsOpen(true)}
                        className="w-12 h-12 flex items-center justify-center bg-gray-500/30 backdrop-blur-sm border border-white/20 rounded-full text-white hover:bg-white/20 transition-all transform hover:scale-110 shadow-lg"
                        aria-label="Open Controls"
                        title="Open Controls Panel"
                    >
                        <GearIcon className="w-6 h-6" />
                    </button>
                )}

                {SHOW_MUTE_BUTTON && (
                    <button
                        onClick={handleVolumeToggle}
                        className={`w-12 h-12 flex items-center justify-center rounded-full transition-all transform hover:scale-110 shadow-lg border backdrop-blur-sm
                                    ${soundConfig.enabled ? 'bg-white/90 text-black border-gray-300' : 'bg-gray-500/30 text-white border-white/20'}`}
                        aria-label={`Toggle Sound`}
                        title={`Sound: ${!soundConfig.enabled ? 'Off' : 'On'}`}
                    >
                        {getVolumeIcon()}
                    </button>
                )}

                {EDITMODE && SHOW_SHARE_BUTTON && (
                    <div className="relative">
                        <button
                            onClick={handleShareClick}
                            className="w-12 h-12 flex items-center justify-center rounded-full text-white transition-all transform hover:scale-110 shadow-lg bg-gray-500/30 backdrop-blur-sm border border-white/20"
                            aria-label="Copy shareable link"
                            title="Copy Shareable Link"
                        >
                            <span className="material-symbols-outlined">share</span>
                        </button>
                        {isLinkCopied && (
                            <div 
                                className="absolute right-full mr-2 top-1/2 -translate-y-1/2 px-3 py-1 bg-white/90 backdrop-blur-sm text-black text-xs font-semibold rounded-full shadow-lg whitespace-nowrap border border-gray-300"
                                aria-live="polite"
                            >
                                Link Copied!
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

const App: React.FC = () => {
    const store = useAppStoreComplete();
    return (
        <AppProvider value={store}>
            <AppContent />
        </AppProvider>
    );
};

export default App;
