// Global variables
let transcriptionDataText = '';
let transcriptionDataSRT = '';
const MAX_CHUNK_SIZE = 25 * 1024 * 1024; // 25MB in bytes
const API_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    const apiKey = localStorage.getItem('groqApiKey');
    document.getElementById('apiRequest').style.display = apiKey ? 'none' : 'block';
    document.getElementById('startProcessBtn').style.display = apiKey ? 'block' : 'none';
    initializeTabs();
});

function initializeTabs() {
    document.getElementById('textTab').style.display = 'block';
    document.querySelector("[data-format='text']").classList.add('active');
}

// API Key Management
function saveApiKey() {
    const apiKey = document.getElementById('apiKeyInput').value;
    if (apiKey) {
        localStorage.setItem('groqApiKey', apiKey);
        document.getElementById('apiRequest').style.display = 'none';
        document.getElementById('startProcessBtn').style.display = 'block';
    }
}

// File Upload Handling
function triggerFileUpload() {
    document.getElementById('audioFile').click();
}

document.getElementById('audioFile').addEventListener('change', function() {
    const fileName = this.files[0]?.name || "לא נבחר קובץ";
    document.getElementById('fileName').textContent = fileName;
    document.getElementById('uploadBtn').disabled = !this.files[0];
});

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

// Main Processing Function
async function uploadAudio() {
    const apiKey = localStorage.getItem('groqApiKey');
    if (!apiKey) {
        alert('מפתח API חסר. נא להזין מחדש.');
        return;
    }

    const file = document.getElementById('audioFile').files[0];
    if (!file) {
        alert('אנא בחר קובץ להעלאה.');
        return;
    }

    openModal('modal3');
    try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('model', 'whisper-large-v3-turbo');
        formData.append('response_format', 'json');
        formData.append('language', 'he');

        updateProgress(10);
        
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}` },
            body: formData
        });

        updateProgress(50);

        if (!response.ok) {
            if (response.status === 401) {
                localStorage.removeItem('groqApiKey');
                throw new Error('Invalid API key');
            }
            throw new Error(`API Error: ${response.status}`);
        }

        const result = await response.json();
        updateProgress(90);

        if (result.text) {
            transcriptionDataText = result.text;
            generateSRTFormat(result);
            showResults();
        } else {
            throw new Error('No transcription data received');
        }

    } catch (error) {
        console.error('Error:', error);
        alert(error.message === 'Invalid API key' ? 
            'שגיאה במפתח API. נא להזין מפתח חדש.' : 
            'שגיאה בתהליך התמלול. נא לנסות שוב.');
        
        if (error.message === 'Invalid API key') {
            location.reload();
        }
    } finally {
        closeModal('modal3');
    }
}

function updateProgress(percent) {
    document.getElementById('progress').style.width = `${percent}%`;
    document.getElementById('progressText').textContent = `${Math.round(percent)}%`;
}

function generateSRTFormat(result) {
    if (!result.segments) {
        transcriptionDataSRT = '';
        return;
    }

    transcriptionDataSRT = result.segments.map((segment, index) => {
        const startTime = formatTimestamp(segment.start);
        const endTime = formatTimestamp(segment.end);
        return `${index + 1}\n${startTime} --> ${endTime}\n${segment.text.trim()}\n`;
    }).join('\n');
}

function formatTimestamp(seconds) {
    if (typeof seconds !== 'number' || isNaN(seconds)) {
        return '00:00:00,000';
    }
    
    const date = new Date(seconds * 1000);
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    const secs = String(date.getUTCSeconds()).padStart(2, '0');
    const millis = String(date.getUTCMilliseconds()).padStart(3, '0');
    
    return `${hours}:${minutes}:${secs},${millis}`;
}

function showResults() {
    openModal('modal4');
    displayTranscription('text');
}

// Tab Management and Content Display
function displayTranscription(format) {
    const contentId = format === 'text' ? 'textContent' : 'srtContent';
    const content = format === 'text' ? transcriptionDataText : transcriptionDataSRT;
    
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
    document.querySelectorAll('.tablinks').forEach(btn => {
        btn.classList.remove('active');
    });
    evt.currentTarget.classList.add('active');
    
    const format = evt.currentTarget.getAttribute('data-format');
    displayTranscription(format);
}

// Download Functionality
function downloadTranscription() {
    const activeTab = document.querySelector('.tablinks.active');
    if (!activeTab) {
        alert('לא נבחר פורמט להורדה. נא לבחור פורמט תמלול.');
        return;
    }

    const format = activeTab.getAttribute('data-format');
    const content = format === 'text' ? transcriptionDataText : transcriptionDataSRT;
    
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

// Reset Process
function restartProcess() {
    closeModal('modal4');
    document.getElementById('audioFile').value = '';
    document.getElementById('fileName').textContent = 'לא נבחר קובץ';
    document.getElementById('uploadBtn').disabled = true;
    openModal('modal1');
    
    transcriptionDataText = '';
    transcriptionDataSRT = '';
}
