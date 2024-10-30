/// Constants
const MAX_CHUNK_SIZE = 24 * 1024 * 1024; // 24MB for splitting and uploading
const API_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
// const WAIT_TIME_BETWEEN_CHUNKS = 10000; // 10 seconds wait between each chunk upload
const WAIT_TIME_BETWEEN_CHUNKS = 1000; // 1 seconds wait between each chunk upload

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
async function splitAudioFile(file) {
    const chunkSize = 24 * 1024 * 1024; // גודל כל מקטע הוא 24 מגה
    const chunks = Math.ceil(file.size / chunkSize);
    const audioChunks = [];

    for (let i = 0; i < chunks; i++) {
        const start = i * chunkSize;
        const end = Math.min((i + 1) * chunkSize, file.size);
        const chunk = file.slice(start, end);

        // יצירת קובץ חדש מסוג WAV
        audioChunks.push(new File([chunk], `chunk_${i + 1}.wav`, { type: 'audio/wav' }));
    }

    return audioChunks;
}





// API Communication
async function transcribeChunk(chunk, apiKey) {
    const formData = new FormData();
    formData.append('file', chunk);
    formData.append('model', 'whisper-large-v3-turbo');
    formData.append('response_format', 'verbose_json');
    formData.append('language', 'he');

    const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`
        },
        body: formData
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
    }

    return await response.json();
}

function showMessage(message, duration = 3000) {
    const messageElement = document.createElement('div');
    messageElement.textContent = message;
    messageElement.style.position = 'fixed';
    messageElement.style.top = '20px';
    messageElement.style.left = '50%';
    messageElement.style.transform = 'translateX(-50%)';
    messageElement.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
    messageElement.style.color = 'white';
    messageElement.style.padding = '10px 20px';
    messageElement.style.borderRadius = '5px';
    messageElement.style.zIndex = '1000';
    document.body.appendChild(messageElement);

    setTimeout(() => {
        document.body.removeChild(messageElement);
    }, duration);
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
        const chunks = await splitAudioFile(file);

        // Sequentially process each chunk
        for (let i = 0; i < chunks.length; i++) {
            updateProgress((i / chunks.length) * 100);
            showMessage(`מתמלל חלק ${i + 1} מתוך ${chunks.length}...`, 0);
            const result = await transcribeChunk(chunks[i], apiKey);
            
            if (result.text) {
                state.transcriptionText += result.text + ' ';
                if (result.segments) {
                    const adjustedSegments = adjustSegmentTimings(result.segments, i, chunks.length);
                    state.segments.push(...adjustedSegments);
                }
            }

            // Wait between each chunk upload to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, WAIT_TIME_BETWEEN_CHUNKS));
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
    if (!state.segments || state.segments.length === 0) {
        console.error("אין תוצאות תמלול זמינות ליצירת SRT");
        return;
    }

    let srtContent = '';
    let index = 1;

    state.segments.forEach(segment => {
        const start = formatTimestamp(segment.start);
        const end = formatTimestamp(segment.end);
        const text = segment.text;

        srtContent += `${index}\n${start} --> ${end}\n${text}\n\n`;
        index++;
    });

    const srtElement = document.getElementById("srtContent");
    if (srtElement) {
        srtElement.textContent = srtContent;
    } else {
        console.error("אלמנט עם ID 'srtContent' לא נמצא");
    }
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

// Tab Management
function openTab(evt, tabName) {
    // הסתרת כל הטאבים
    document.querySelectorAll('.tabcontent').forEach(tab => {
        tab.style.display = 'none';
        tab.classList.remove('active');
    });

    // הסרת ה"active" מכל הכפתורים
    document.querySelectorAll('.tablinks').forEach(button => button.classList.remove('active'));

    // הצגת התוכן הנבחר
    const selectedContent = document.getElementById(tabName);
    if (selectedContent) {
        selectedContent.style.display = 'block';
        selectedContent.classList.add('active');
    } else {
        console.error(`אלמנט עם ID '${tabName}' לא נמצא`);
    }

    // הוספת מחלקת "active" לכפתור הנוכחי
    if (evt && evt.currentTarget) {
        evt.currentTarget.classList.add('active');
    } else {
        console.error(`לא נמצא הכפתור עבור הטאב '${tabName}'`);
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
