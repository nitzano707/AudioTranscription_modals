// Constants
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB
const CHUNK_SIZE = 20 * 1024 * 1024;    // 20MB for safety
const API_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

// State Management
let state = {
    isProcessing: false,
    transcriptionText: '',
    transcriptionSRT: '',
    currentOffset: 0,
    segments: []
};

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    initializeUI();
    setupEventListeners();
});

function initializeUI() {
    const apiKey = localStorage.getItem('groqApiKey');
    document.getElementById('apiRequest').style.display = apiKey ? 'none' : 'block';
    document.getElementById('startProcessBtn').style.display = apiKey ? 'block' : 'none';
}

function setupEventListeners() {
    const fileInput = document.getElementById('audioFile');
    fileInput.addEventListener('change', handleFileSelection);
}

// File Handling
function handleFileSelection(event) {
    const file = event.target.files[0];
    const fileName = file ? file.name : "לא נבחר קובץ";
    document.getElementById('fileName').textContent = fileName;
    document.getElementById('uploadBtn').disabled = !file;
}

function triggerFileUpload() {
    if (!state.isProcessing) {
        document.getElementById('audioFile').click();
    }
}

// Audio Processing
class AudioChunker {
    constructor(file) {
        this.file = file;
        this.offset = 0;
        this.chunks = [];
    }

    async initialize() {
        if (this.file.size <= MAX_FILE_SIZE) {
            this.chunks = [this.file];
            return;
        }

        let offset = 0;
        while (offset < this.file.size) {
            const end = Math.min(offset + CHUNK_SIZE, this.file.size);
            const chunk = this.file.slice(offset, end);
            const chunkFile = new File([chunk], `chunk_${this.chunks.length}.${this.file.name.split('.').pop()}`, {
                type: this.file.type
            });
            this.chunks.push(chunkFile);
            offset = end;
        }
    }

    getChunks() {
        return this.chunks;
    }

    getChunksCount() {
        return this.chunks.length;
    }
}

// API Communication
async function transcribeChunk(chunk, apiKey, retryCount = 0) {
    const formData = new FormData();
    formData.append('file', chunk);
    formData.append('model', 'whisper-large-v3-turbo');
    formData.append('response_format', 'verbose_json');
    formData.append('language', 'he');

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`
            },
            body: formData
        });

        if (response.status === 429 && retryCount < 3) {
            const waitTime = Math.pow(2, retryCount) * 6000;
            await new Promise(resolve => setTimeout(resolve, waitTime));
            return transcribeChunk(chunk, apiKey, retryCount + 1);
        }

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        return result;

    } catch (error) {
        console.error('Transcription error:', error);
        throw error;
    }
}

// Main Processing
async function uploadAudio() {
    if (state.isProcessing) return;

    const apiKey = localStorage.getItem('groqApiKey');
    const file = document.getElementById('audioFile').files[0];

    if (!apiKey || !file) {
        alert(!apiKey ? 'מפתח API חסר. נא להזין מחדש.' : 'אנא בחר קובץ להעלאה.');
        return;
    }

    state.isProcessing = true;
    resetState();
    openModal('modal3');

    try {
        const chunker = new AudioChunker(file);
        await chunker.initialize();
        const chunks = chunker.getChunks();

        for (let i = 0; i < chunks.length; i++) {
            updateProgress((i / chunks.length) * 100);
            const result = await transcribeChunk(chunks[i], apiKey);
            
            if (result.text) {
                state.transcriptionText += result.text + ' ';
                if (result.segments) {
                    const adjustedSegments = adjustSegmentTimings(result.segments, i, chunks.length);
                    state.segments.push(...adjustedSegments);
                }
            }
        }

        state.transcriptionText = state.transcriptionText.trim();
        generateSRTFormat();
        showResults();

    } catch (error) {
        console.error('Processing error:', error);
        handleError(error);
    } finally {
        state.isProcessing = false;
        closeModal('modal3');
    }
}

function adjustSegmentTimings(segments, chunkIndex, totalChunks) {
    const chunkDuration = 30; // Approximate chunk duration in seconds
    const timeOffset = chunkIndex * chunkDuration;
    
    return segments.map(segment => ({
        ...segment,
        start: segment.start + timeOffset,
        end: segment.end + timeOffset
    }));
}

function generateSRTFormat() {
    if (!state.segments.length) {
        state.transcriptionSRT = state.transcriptionText ? 
            `1\n00:00:00,000 --> ${formatTimestamp(30)}\n${state.transcriptionText}\n` : 
            '';
        return;
    }

    state.transcriptionSRT = state.segments.map((segment, index) => 
        `${index + 1}\n${formatTimestamp(segment.start)} --> ${formatTimestamp(segment.end)}\n${segment.text.trim()}\n`
    ).join('\n');
}

// UI Functions
function saveApiKey() {
    const apiKey = document.getElementById('apiKeyInput').value.trim();
    if (apiKey) {
        localStorage.setItem('groqApiKey', apiKey);
        document.getElementById('apiRequest').style.display = 'none';
        document.getElementById('startProcessBtn').style.display = 'block';
    }
}

function updateProgress(percent) {
    document.getElementById('progress').style.width = `${percent}%`;
    document.getElementById('progressText').textContent = `${Math.round(percent)}%`;
}

function handleError(error) {
    console.error('Error details:', error);
    if (error.message.includes('401')) {
        alert('שגיאה במפתח API. נא להזין מפתח חדש.');
        localStorage.removeItem('groqApiKey');
        location.reload();
    } else {
        alert('שגיאה בתהליך התמלול. נא לנסות שוב.');
    }
}

// Modal Management
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'block';
        document.body.classList.add('modal-open');
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.style.display = 'none';
        document.body.classList.remove('modal-open');
    }
}

// Display Functions
function showResults() {
    openModal('modal4');
    displayTranscription('text');
}

function displayTranscription(format) {
    const contentId = format === 'text' ? 'textContent' : 'srtContent';
    const content = format === 'text' ? state.transcriptionText : state.transcriptionSRT;
    
    document.querySelectorAll('.tabcontent').forEach(tab => {
        tab.style.display = 'none';
        tab.classList.remove('active');
    });
    
    const selectedTab = document.getElementById(format + 'Tab');
    const contentElement = document.getElementById(contentId);
    
    if (selectedTab && contentElement) {
        selectedTab.style.display = 'block';
        selectedTab.classList.add('active');
        contentElement.textContent = content;
    }
}

function openTab(evt, tabName) {
    document.querySelectorAll('.tablinks').forEach(btn => btn.classList.remove('active'));
    evt.currentTarget.classList.add('active');
    displayTranscription(evt.currentTarget.getAttribute('data-format'));
}

// Utility Functions
function formatTimestamp(seconds) {
    if (typeof seconds !== 'number' || isNaN(seconds)) {
        return '00:00:00,000';
    }
    
    const date = new Date(seconds * 1000);
    return [
        String(date.getUTCHours()).padStart(2, '0'),
        String(date.getUTCMinutes()).padStart(2, '0'),
        String(date.getUTCSeconds()).padStart(2, '0')
    ].join(':') + ',' + String(date.getUTCMilliseconds()).padStart(3, '0');
}

function downloadTranscription() {
    const activeTab = document.querySelector('.tablinks.active');
    if (!activeTab) {
        alert('לא נבחר פורמט להורדה. נא לבחור פורמט תמלול.');
        return;
    }

    const format = activeTab.getAttribute('data-format');
    const content = format === 'text' ? state.transcriptionText : state.transcriptionSRT;
    
    if (!content) {
        alert('אין תמלול להורדה.');
        return;
    }

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcription.${format === 'text' ? 'txt' : 'srt'}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Reset Functions
function resetState() {
    state = {
        isProcessing: state.isProcessing,
        transcriptionText: '',
        transcriptionSRT: '',
        currentOffset: 0,
        segments: []
    };
    updateProgress(0);
}

function restartProcess() {
    if (!state.isProcessing) {
        closeModal('modal4');
        document.getElementById('audioFile').value = '';
        document.getElementById('fileName').textContent = 'לא נבחר קובץ';
        document.getElementById('uploadBtn').disabled = true;
        openModal('modal1');
        resetState();
    }
}
