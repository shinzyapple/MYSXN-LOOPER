// State Management
let songs = [];
let currentSongId = null;
let currentSectionIndex = null;
let nextSectionIndex = null;
let isPlaying = false;

// Audio Context
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
let audioBuffers = {}; // sectionId -> AudioBuffer
let currentSourceNode = null;
let currentGainNode = null;
let startTime = 0; // The time when the current section started or was seeked
let seekOffset = 0; // Cumulative duration from start of buffer when seeked
let timerInterval = null;
let isSeeking = false;

// IndexedDB settings for Web Mode persistence
const DB_NAME = "MYSXN_Audio_Cache";
const STORE_NAME = "audio_blobs";

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

async function saveDB(name, blob) {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(blob, name);
    return new Promise((resolve) => tx.oncomplete = resolve);
}

async function getDB(name) {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(name);
    return new Promise((resolve) => {
        request.onsuccess = () => resolve(request.result);
    });
}

// UI Elements
const sidebar = document.getElementById('sidebar');
const songListEl = document.getElementById('song-list');
const sectionGridEl = document.getElementById('section-grid');
const countdownEl = document.getElementById('time-remaining');
const stateBadge = document.getElementById('state-badge');
const nextInfoBadge = document.getElementById('next-info-badge');

// Initialization
document.addEventListener('DOMContentLoaded', async () => {
    // Show sidebar by default on large screens
    if (window.innerWidth >= 769) {
        sidebar.classList.remove('hidden');
    }
    setupEventListeners(); // Bind events first
    await checkConfig();
});

let projectFolder = "";

let isWebMode = false;
let webAudioFiles = {}; // fileName -> Blob URL (temporary session storage)

async function checkConfig() {
    try {
        // Automatically assume Web Mode if running on vercel.app or similar
        const isVercelLocal = window.location.hostname.includes('vercel.app');

        const res = await fetch('/api/config');
        if (!res.ok) throw new Error('Config API unreachable');
        const data = await res.json();

        if (data.is_vercel || isVercelLocal) {
            isWebMode = true;
            console.log('Running in Web Mode (Cloud)');
            document.getElementById('select-project-btn').textContent = 'JSON読込';
            document.getElementById('project-path-display').textContent = 'Web保存 (localStorage)';
            document.getElementById('current-song-name').textContent = 'JSONファイルを読み込むか、曲を作成してください';
        } else {
            projectFolder = data.project_folder;
            updateProjectUI();
            if (!projectFolder) {
                document.getElementById('current-song-name').textContent = 'プロジェクトフォルダを選択してください';
            }
        }

        await fetchSongs();
    } catch (err) {
        console.error('Failed to detect environment, using Local fallback:', err);
        // If we can't even reach the API, we're likely in a statically served environment (Web Mode)
        if (window.location.hostname !== '127.0.0.1' && window.location.hostname !== 'localhost') {
            isWebMode = true;
            document.getElementById('select-project-btn').textContent = 'JSON読込';
        }
        await fetchSongs();
    }
}

function updateProjectUI() {
    const display = document.getElementById('project-path-display');
    if (projectFolder) {
        display.textContent = projectFolder.split('/').pop() || projectFolder;
        display.title = projectFolder;
    } else {
        display.textContent = 'フォルダ未選択';
        display.title = '';
    }
}

async function selectProjectFolder() {
    if (isWebMode) {
        // In Web mode, this button acts as "Import JSON"
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (e) => {
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.onload = (event) => {
                const data = JSON.parse(event.target.result);
                if (data.songs) {
                    songs = data.songs;
                    saveToLocalStorage();
                    renderSongList();
                    if (songs.length > 0) selectSong(songs[0].id);
                    alert('JSONを読み込みました');
                }
            };
            reader.readAsText(file);
        };
        input.click();
        return;
    }

    console.log('Select project folder clicked');
    const btn = document.getElementById('select-project-btn');
    const originalText = btn.textContent;
    try {
        btn.textContent = '...';
        btn.disabled = true;
        const res = await fetch('/api/pick-folder');
        const data = await res.json();
        console.log('Folder picker result:', data);
        if (data.path) {
            projectFolder = data.path;
            await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ project_folder: projectFolder })
            });
            updateProjectUI();
            await fetchSongs();
        } else if (data.detail) {
            alert('サーバーエラー: ' + data.detail + '\n\n※Vercel環境ではフォルダ選択は使用できません。');
        } else if (data.error && data.error !== 'No path selected') {
            alert('エラー: ' + data.error);
        }
    } catch (err) {
        console.error('Folder picker failed:', err);
        alert('通信エラーが発生しました。ローカルサーバーが起動しているか確認してください。');
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

async function fetchSongs() {
    try {
        // Always try localStorage first in Web Mode
        const localData = localStorage.getItem('mysxn_songs');
        if (localData) {
            songs = JSON.parse(localData).songs;
            console.log('Loaded from localStorage');
        } else {
            const res = await fetch('/api/songs');
            const data = await res.json();
            songs = data.songs;
        }

        renderSongList();
        if (songs.length > 0) {
            selectSong(songs[0].id);
        }
    } catch (err) {
        console.error('Failed to fetch songs:', err);
    }
}

function saveToLocalStorage() {
    localStorage.setItem('mysxn_songs', JSON.stringify({ songs }));
}

function exportSongsToJSON() {
    const dataStr = JSON.stringify({ songs }, null, 4);
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);

    const exportFileDefaultName = 'mysxn_project.json';

    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
}

function renderSongList() {
    songListEl.innerHTML = '';
    songs.forEach(song => {
        const div = document.createElement('div');
        div.className = `song-item ${song.id === currentSongId ? 'active' : ''}`;
        div.textContent = song.name;
        div.onclick = () => selectSong(song.id);
        songListEl.appendChild(div);
    });
}

function selectSong(id) {
    currentSongId = id;
    renderSongList();
    const song = songs.find(s => s.id === id);
    document.getElementById('current-song-name').textContent = song.name;

    // Close sidebar on mobile after selection
    if (window.innerWidth < 769) {
        sidebar.classList.add('hidden');
    }

    // Reset playback state
    stopPlayback();
    renderSections();
    prepareSettingsForm();

    // Preload audio buffers
    preloadAudio(song);
}

async function preloadAudio(song) {
    audioBuffers = {};
    for (const section of song.sections) {
        if (section.file) {
            try {
                let url;
                let blob;

                if (section.file.startsWith('blob:')) {
                    url = section.file;
                } else if (webAudioFiles[section.file]) {
                    url = webAudioFiles[section.file];
                } else if (isWebMode) {
                    // Try to restore from IndexedDB
                    blob = await getDB(section.file);
                    if (blob) {
                        url = URL.createObjectURL(blob);
                        webAudioFiles[section.file] = url;
                        console.log(`Restored ${section.name} from cache`);
                    }
                }

                if (!url) {
                    url = `/audio?path=${encodeURIComponent(section.file)}`;
                }

                console.log(`Loading audio: ${section.name} from ${url}`);
                const response = await fetch(url);
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                const arrayBuffer = await response.arrayBuffer();
                const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
                audioBuffers[section.id] = audioBuffer;
                console.log(`Loaded: ${section.name}`);
            } catch (e) {
                console.error(`Failed to load audio for ${section.name}:`, e);
            }
        }
    }
}

function renderSections() {
    sectionGridEl.innerHTML = '';
    const song = songs.find(s => s.id === currentSongId);
    if (!song) return;

    song.sections.forEach((section, index) => {
        const card = document.createElement('div');
        card.className = `section-card ${index === currentSectionIndex ? 'active' : ''}`;
        card.innerHTML = `
            <span class="section-type-icon">${section.type}</span>
            <div style="font-weight: 700;">${section.name}</div>
        `;
        card.onclick = () => {
            if (isPlaying) {
                requestSectionChange(index);
            } else {
                currentSectionIndex = index;
                renderSections();
            }
        };
        sectionGridEl.appendChild(card);
    });
}

// Playback Logic
async function startPlayback() {
    if (!currentSongId || isPlaying) return;

    // Resume AudioContext (required by browsers)
    if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
    }

    const song = songs.find(s => s.id === currentSongId);
    if (!song || song.sections.length === 0) return;

    // Start with the first section (usually intro)
    currentSectionIndex = 0;
    isPlaying = true;
    updateUIForPlayback(true);
    playSection(currentSectionIndex);
}

function stopPlayback() {
    isPlaying = false;
    currentSectionIndex = null;
    nextSectionIndex = null;
    updateUIForPlayback(false);
    if (currentSourceNode) {
        currentSourceNode.stop();
        currentSourceNode = null;
    }
    if (timerInterval) clearInterval(timerInterval);
    countdownEl.textContent = '--:--';
    stateBadge.textContent = 'READY';
    stateBadge.className = 'status-badge';
    nextInfoBadge.style.display = 'none';
    renderSections();
}

function playSection(index, offset = 0) {
    const song = songs.find(s => s.id === currentSongId);
    if (!song) return;
    const section = song.sections[index];
    const buffer = audioBuffers[section.id];

    if (!buffer) {
        console.error('Buffer not loaded for section:', section.name);
        stopPlayback();
        return;
    }

    if (currentSourceNode) {
        currentSourceNode.onended = null;
        try { currentSourceNode.stop(); } catch (e) { }
    }

    currentSourceNode = audioCtx.createBufferSource();
    currentSourceNode.buffer = buffer;

    currentGainNode = audioCtx.createGain();
    currentSourceNode.connect(currentGainNode).connect(audioCtx.destination);

    startTime = audioCtx.currentTime;
    seekOffset = offset;

    // Section Type Logic
    if (section.type === 'intro') {
        currentSourceNode.loop = false;
        currentSourceNode.onended = () => {
            if (isPlaying && !isSeeking) {
                // For Intro, automatically move to next section if it's the first play
                if (index === 0) playSection(index + 1);
            }
        };
        stateBadge.textContent = 'INTRO';
    } else if (section.type === 'outro') {
        currentSourceNode.loop = false;
        currentSourceNode.onended = () => {
            if (isPlaying && !isSeeking) stopPlayback();
        };
        stateBadge.textContent = 'OUTRO';
    } else {
        currentSourceNode.loop = true;
        stateBadge.textContent = 'LOOPING';
    }
    stateBadge.className = 'status-badge looping';

    currentSectionIndex = index;
    currentSourceNode.start(0, offset);
    renderSections();
    startTimer();

    document.getElementById('duration-display').textContent = formatTime(buffer.duration);
}

function requestSectionChange(index) {
    if (index === currentSectionIndex) return;
    nextSectionIndex = index;
    nextInfoBadge.textContent = 'NEXT: ' + songs.find(s => s.id === currentSongId).sections[index].name;
    nextInfoBadge.style.display = 'inline-block';
    nextInfoBadge.className = 'status-badge waiting';

    // We need to wait for the current section to reach near its end, then crossfade.
    // Instead of simple loop=true, we might need a more controlled play loop if we want to crossfade at the end of a loop.
    // However, the prompt says "現在のセクションが最後まで再生されるのを待ち...".
    // This implies even if it's looping, it should finish the CURRENT loop cycle.

    // We update the timer to show countdown to transition.
    checkAndScheduleTransition();
}

function checkAndScheduleTransition() {
    // Handling is done in startTimer
}

function performTransition(fromIndex, toIndex) {
    const song = songs.find(s => s.id === currentSongId);
    const fromSection = song.sections[fromIndex];
    const toSection = song.sections[toIndex];

    const fromBuffer = audioBuffers[fromSection.id];
    const toBuffer = audioBuffers[toSection.id];

    if (!toBuffer) return;

    // "現在のセクションの最後２秒と次のセクションの最初の２秒をクロスさせる"
    // Since currentSourceNode is ending naturally (we set loop=false), we want to start the next one 2s BEFORE it ends.
    // But onended fires at the actual end.
    // To achieve the 2s overlap, we should have started the next one 2s earlier.

    // Let's refine the logic:
    // Instead of waiting for onended, we schedule the transition at specific time.
}

// Let's rewrite the playback to handle scheduling better.
// Using a scheduler is more precise for audio.

function startTimer() {
    if (timerInterval) clearInterval(timerInterval);
    const seekBar = document.getElementById('seek-bar');
    const currentTimeDisplay = document.getElementById('current-time-display');

    timerInterval = setInterval(() => {
        const song = songs.find(s => s.id === currentSongId);
        if (!song || currentSectionIndex === null || isSeeking) return;
        const section = song.sections[currentSectionIndex];
        const buffer = audioBuffers[section.id];
        if (!buffer) return;

        const now = audioCtx.currentTime;
        const playedSinceStart = (now - startTime);
        const totalElapsed = (seekOffset + playedSinceStart) % buffer.duration;
        const remaining = buffer.duration - totalElapsed;

        countdownEl.textContent = formatTime(remaining);
        currentTimeDisplay.textContent = formatTime(totalElapsed);

        if (!isSeeking) {
            seekBar.value = (totalElapsed / buffer.duration) * 100;
        }

        // If we have a next section requested, check if it's time to start crossfade (2s before end)
        if (nextSectionIndex !== null && remaining <= 2 && !currentSourceNode.isTransitioning) {
            currentSourceNode.isTransitioning = true;
            const useFade = song.sections[currentSectionIndex].crossfade;
            performLayeredTransition(currentSectionIndex, nextSectionIndex, useFade);
        }
    }, 50);
}

function performLayeredTransition(fromIdx, toIdx, useFade) {
    const song = songs.find(s => s.id === currentSongId);
    const fromSection = song.sections[fromIdx];
    const toSection = song.sections[toIdx];

    const toBuf = audioBuffers[toSection.id];
    if (!toBuf) return;

    const now = audioCtx.currentTime;
    const transitionDuration = 2;

    // Create next one
    const nextSource = audioCtx.createBufferSource();
    nextSource.buffer = toBuf;
    const nextGain = audioCtx.createGain();
    nextSource.connect(nextGain).connect(audioCtx.destination);

    const oldSource = currentSourceNode;
    const oldGain = currentGainNode;

    // Disable loop on old source
    if (oldSource) {
        oldSource.loop = false;
        oldSource.onended = null;
    }

    if (useFade) {
        // --- FADE ON ---
        const offset = Math.max(0, toBuf.duration - transitionDuration);

        // Crossfade
        nextGain.gain.setValueAtTime(0, now);
        nextGain.gain.linearRampToValueAtTime(1, now + transitionDuration);
        if (oldGain) {
            oldGain.gain.setValueAtTime(oldGain.gain.value, now);
            oldGain.gain.linearRampToValueAtTime(0, now + transitionDuration);
        }

        // Start next section NOW at the tail offset
        nextSource.start(now, offset);

        // Update timing state for UI:
        // For UI purposes, we consider the "new section" started at NOW
        // and its current playback position is at 'offset'
        startTime = now;
        seekOffset = offset;
    } else {
        // --- FADE OFF ---
        // Play next section strictly at the moment the current one ends (now + transitionDuration)
        nextGain.gain.setValueAtTime(1, now + transitionDuration);
        nextSource.start(now + transitionDuration, 0);

        // Update timing state:
        // The UI should show the new section starting at 'now + transitionDuration' from position 0
        startTime = now + transitionDuration;
        seekOffset = 0;
    }

    // Stop old source
    setTimeout(() => {
        if (oldSource) {
            try {
                if (useFade) {
                    oldGain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.1);
                    setTimeout(() => oldSource.stop(), 100);
                } else {
                    oldSource.stop();
                }
            } catch (e) { }
        }
    }, transitionDuration * 1000);

    // Update state
    currentSourceNode = nextSource;
    currentGainNode = nextGain;
    currentSectionIndex = toIdx;
    nextSectionIndex = null;

    // Auto-loop / End logic
    if (toSection.type === 'intro') {
        currentSourceNode.loop = false;
        currentSourceNode.onended = () => {
            if (isPlaying) {
                // If we crossfaded INTO an intro manually, 
                // we probably don't want it to jump anywhere automatically unless it's the start
                if (toIdx === 0) playSection(toIdx + 1);
            }
        };
    } else if (toSection.type === 'outro') {
        currentSourceNode.loop = false;
        currentSourceNode.onended = () => {
            if (isPlaying) stopPlayback();
        };
    } else {
        currentSourceNode.loop = true;
    }

    nextInfoBadge.style.display = 'none';
    renderSections();
}

function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 10);
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms}`;
}

// UI Setup
function setupEventListeners() {
    document.querySelector('.tab-btn[data-tab="playback"]').onclick = (e) => switchTab('playback', e.target);
    document.querySelector('.tab-btn[data-tab="settings"]').onclick = (e) => switchTab('settings', e.target);

    document.getElementById('open-sidebar').onclick = () => sidebar.classList.remove('hidden');
    document.getElementById('close-sidebar').onclick = () => sidebar.classList.add('hidden');

    document.getElementById('play-btn').onclick = startPlayback;
    document.getElementById('stop-btn').onclick = stopPlayback;

    document.getElementById('add-song-btn').onclick = createNewSong;
    document.getElementById('save-song-btn').onclick = saveSong;
    document.getElementById('add-section-field').onclick = () => addSectionConfig();
    document.getElementById('delete-song-btn').onclick = deleteSong;
    document.getElementById('select-project-btn').onclick = selectProjectFolder;
    document.getElementById('export-json-btn').onclick = exportSongsToJSON;

    // Seek Bar events
    const seekBar = document.getElementById('seek-bar');
    seekBar.oninput = () => {
        isSeeking = true;
    };
    seekBar.onchange = () => {
        if (!isPlaying || currentSectionIndex === null) {
            isSeeking = false;
            return;
        }
        const song = songs.find(s => s.id === currentSongId);
        const buffer = audioBuffers[song.sections[currentSectionIndex].id];
        const newOffset = (seekBar.value / 100) * buffer.duration;
        playSection(currentSectionIndex, newOffset);
        isSeeking = false;
    };

    // Close sidebar on mobile when click outside
    window.onclick = (event) => {
        if (window.innerWidth < 768 && !sidebar.contains(event.target) && event.target.id !== 'open-sidebar') {
            sidebar.classList.add('hidden');
        }
    }
}

function switchTab(tabId, btn) {
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    btn.classList.add('active');
}

function updateUIForPlayback(playing) {
    document.getElementById('play-btn').style.display = playing ? 'none' : 'inline-block';
    document.getElementById('stop-btn').style.display = playing ? 'inline-block' : 'none';
}

// Settings / Song Management
function createNewSong() {
    const newSong = {
        id: 'song_' + Date.now(),
        name: '新規プロジェクト',
        sections: [
            { id: 's_' + Date.now() + '_1', name: 'Intro', file: '', type: 'intro' },
            { id: 's_' + Date.now() + '_2', name: 'Outro', file: '', type: 'outro' }
        ]
    };
    songs.push(newSong);
    selectSong(newSong.id);
    switchTab('settings', document.querySelector('.tab-btn[data-tab="settings"]'));
}

function prepareSettingsForm() {
    const song = songs.find(s => s.id === currentSongId);
    if (!song) return;

    document.getElementById('edit-song-name').value = song.name;
    const list = document.getElementById('section-config-list');
    list.innerHTML = '';

    song.sections.forEach(s => addSectionConfig(s));
}

function addSectionConfig(sectionData = null) {
    const list = document.getElementById('section-config-list');
    const div = document.createElement('div');
    div.className = 'section-config-item';

    const id = sectionData ? sectionData.id : 's_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    const name = sectionData ? sectionData.name : '新セクション';
    const file = sectionData ? sectionData.file : '';
    const type = sectionData ? sectionData.type : 'loop';
    const crossfade = sectionData ? (sectionData.crossfade !== undefined ? sectionData.crossfade : true) : true;

    div.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 2px; flex: 0 0 30px;">
            <button class="btn btn-secondary move-up" style="padding: 2px 8px; font-size: 0.6rem;">↑</button>
            <button class="btn btn-secondary move-down" style="padding: 2px 8px; font-size: 0.6rem;">↓</button>
        </div>
        <div style="flex: 0 0 100px;">
            <select class="conf-type" style="padding: 12px 4px;">
                <option value="intro" ${type === 'intro' ? 'selected' : ''}>INTRO</option>
                <option value="loop" ${type === 'loop' ? 'selected' : ''}>LOOP</option>
                <option value="outro" ${type === 'outro' ? 'selected' : ''}>OUTRO</option>
            </select>
        </div>
        <div style="flex: 1;">
            <input type="text" class="conf-name" value="${name}" placeholder="セクション名" style="width:100%;">
        </div>
        <div style="flex: 2; display: flex; gap: 8px;">
            <input type="text" class="conf-file" value="${file}" placeholder="パスを選択..." style="flex: 1;">
            <button class="btn btn-secondary picker-btn" style="padding: 8px 12px; font-size: 0.8rem;">選択</button>
        </div>
        <div style="flex: 0 0 80px; display: flex; align-items: center; gap: 4px; font-size: 0.7rem;">
            <input type="checkbox" class="conf-fade" ${crossfade ? 'checked' : ''} style="width: auto;">
            <span>フェード</span>
        </div>
        <button class="btn btn-secondary" style="padding: 8px 12px;" onclick="this.parentElement.remove()">×</button>
        <input type="hidden" class="conf-id" value="${id}">
    `;

    // Reorder logic
    div.querySelector('.move-up').onclick = () => {
        const prev = div.previousElementSibling;
        if (prev) list.insertBefore(div, prev);
    };
    div.querySelector('.move-down').onclick = () => {
        const next = div.nextElementSibling;
        if (next) list.insertBefore(next, div);
    };

    const pickerBtn = div.querySelector('.picker-btn');
    const fileInput = div.querySelector('.conf-file');
    pickerBtn.onclick = async () => {
        if (isWebMode) {
            const fileInputElem = document.getElementById('web-audio-picker');
            fileInputElem.onchange = async (e) => {
                const file = e.target.files[0];
                if (file) {
                    const blobUrl = URL.createObjectURL(file);
                    // Store in session
                    webAudioFiles[file.name] = blobUrl;
                    // Store in persistent IndexedDB cache
                    await saveDB(file.name, file);

                    fileInput.value = file.name;
                    preloadAudio(songs.find(s => s.id === currentSongId));
                }
            };
            fileInputElem.click();
            return;
        }

        try {
            pickerBtn.textContent = '...';
            pickerBtn.disabled = true;
            const res = await fetch('/api/pick-file');
            const data = await res.json();
            if (data.path) {
                let finalPath = data.path;
                // If the selected file is inside the project folder, make it relative
                if (projectFolder && finalPath.startsWith(projectFolder)) {
                    finalPath = './' + finalPath.slice(projectFolder.length).replace(/^\//, '');
                }
                fileInput.value = finalPath;
            }
        } catch (e) {
            console.error('File picker failed:', e);
            alert('ファイルの選択に失敗しました');
        } finally {
            pickerBtn.textContent = '選択';
            pickerBtn.disabled = false;
        }
    };

    list.appendChild(div);
}

async function saveSong() {
    const song = songs.find(s => s.id === currentSongId);
    if (!song) return;

    song.name = document.getElementById('edit-song-name').value;
    const sectionItems = document.querySelectorAll('.section-config-item');
    const sections = [];

    sectionItems.forEach(item => {
        sections.push({
            id: item.querySelector('.conf-id').value,
            name: item.querySelector('.conf-name').value,
            file: item.querySelector('.conf-file').value,
            type: item.querySelector('.conf-type').value,
            crossfade: item.querySelector('.conf-fade').checked
        });
    });

    song.sections = sections;

    try {
        saveToLocalStorage();

        if (!isWebMode) {
            await fetch('/api/songs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ songs })
            });
        }

        alert('保存しました' + (isWebMode ? ' (ブラウザに保存されました)' : ''));
        renderSongList();
        renderSections();
        preloadAudio(song);
    } catch (e) {
        alert('保存に失敗しました。');
    }
}

async function deleteSong() {
    if (!confirm('本当に削除しますか？')) return;
    songs = songs.filter(s => s.id !== currentSongId);
    currentSongId = songs.length > 0 ? songs[0].id : null;

    await fetch('/api/songs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ songs })
    });

    if (currentSongId) selectSong(currentSongId);
    else location.reload();
}
