// Global variables
let transcriptionDataText = '';
let transcriptionDataSRT = '';
const defaultLanguage = 'he';
let maxChunkSizeMB = 25;
let cumulativeOffset = 0;

document.addEventListener('DOMContentLoaded', () => {
    const apiKey = localStorage.getItem('groqApiKey');
    
    if (!apiKey) {
        document.getElementById('apiRequest').style.display = 'block';
    } else {
        document.getElementById('apiRequest').style.display = 'none';
        document.getElementById('startProcessBtn').style.display = 'block';
    }
    
    initializeTabs();
});

function initializeTabs() {
    const textTab = document.getElementById('textTab');
    const textButton = document.querySelector("button[data-format='text']");
    
    if (textTab && textButton) {
        textTab.style.display = 'block';
        textButton.classList.add('active');
    }
}

function saveApiKey() {
    const apiKeyInput = document.getElementById('apiKeyInput').value;
    if (apiKeyInput) {
        localStorage.setItem('groqApiKey', apiKeyInput);
        document.getElementById('apiRequest').style.display = 'none';
        document.getElementById('startProcessBtn').style.display = 'block';
    }
}

function triggerFileUpload() {
    document.getElementById('audioFile').click();
}

document.getElementById('audioFile').addEventListener('change', function() {
    const fileName = this.files[0] ? this.files[0].name : "לא נבחר קובץ";
    document.getElementById('fileName').textContent = fileName;
    document.getElementById('uploadBtn').disabled = !this.files[0];
});

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

async function uploadAudio() {
    const apiKey = localStorage.getItem('groqApiKey');
    if (!apiKey) {
        alert('מפתח API חסר. נא להזין מחדש.');
        return;
    }

    const audioFile = document.getElementById('audioFile').files[0];
    if (!audioFile) {
        alert('אנא בחר קובץ להעלאה.');
        return;
    }

    openModal('modal3');
    
    try {
        const chunks = await splitAudioToChunks(audioFile);
        await processChunks(chunks, audioFile.name);
        showTranscriptionResults();
    } catch (error) {
        console.error('Error during processing:', error);
        alert('שגיאה בתהליך התמלול. נא לנסות שוב.');
        closeModal('modal3');
    }
}

async function splitAudioToChunks(file) {
    const maxChunkSizeBytes = maxChunkSizeMB * 1024 * 1024;
    return file.size <= maxChunkSizeBytes ? [file] : await splitLargeFile(file);
}

async function splitLargeFile(file) {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    
    const numberOfChunks = Math.ceil(file.size / (maxChunkSizeMB * 1024 * 1024));
    const chunkDuration = audioBuffer.duration / numberOfChunks;
    
    let chunks = [];
    let currentTime = 0;
    
    while (currentTime < audioBuffer.duration) {
        const chunk = await createChunk(audioBuffer, currentTime, chunkDuration);
        chunks.push(chunk);
        currentTime += chunkDuration;
    }
    
    return chunks;
}

async function processChunks(chunks, fileName) {
    const transcriptionData = [];
    
    for (let i = 0; i < chunks.length; i++) {
        updateProgress((i + 1) / chunks.length * 100);
        
        const response = await sendChunkToAPI(chunks[i]);
        if (response.segments) {
            processSegments(response.segments, transcriptionData);
        }
    }
    
    saveTranscriptions(transcriptionData);
}

function updateProgress(percent) {
    const progress = document.getElementById('progress');
    const progressText = document.getElementById('progressText');
    if (progress && progressText) {
        progress.style.width = `${percent}%`;
        progressText.textContent = `${Math.round(percent)}%`;
    }
}

async function sendChunkToAPI(chunk) {
    const formData = new FormData();
    formData.append('file', chunk);
    formData.append('model', 'whisper-large-v3-turbo');
    formData.append('response_format', 'json');
    formData.append('language', defaultLanguage);

    const apiKey = localStorage.getItem('groqApiKey');
    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}` },
        body: formData
    });

    if (!response.ok) {
        if (response.status === 401) {
            localStorage.removeItem('groqApiKey');
            location.reload();
        }
        throw new Error(`API Error: ${response.status}`);
    }

    return await response.json();
}

function processSegments(segments, transcriptionData) {
    segments.forEach(segment => {
        if (typeof segment.start === 'number' && typeof segment.end === 'number') {
            transcriptionData.push({
                text: segment.text.trim(),
                timestamp: `${formatTimestamp(segment.start + cumulativeOffset)} --> ${formatTimestamp(segment.end + cumulativeOffset)}`
            });
        }
    });
    
    if (segments.length > 0) {
        cumulativeOffset += segments[segments.length - 1].end;
    }
}

function showTranscriptionResults() {
    closeModal('modal3');
    openModal('modal4');
    displayTranscription('text');
}

function formatTimestamp(seconds) {
    if (typeof seconds !== 'number' || isNaN(seconds)) return '00:00:00,000';
    
    const date = new Date(seconds * 1000);
    return `${String(date.getUTCHours()).padStart(2, '0')}:${
        String(date.getUTCMinutes()).padStart(2, '0')}:${
        String(date.getUTCSeconds()).padStart(2, '0')},${
        String(date.getUTCMilliseconds()).padStart(3, '0')}`;
}

function saveTranscriptions(data) {
    transcriptionDataText = data.map(d => {
        const text = d.text.trim();
        return /[.?!]$/.test(text) ? text : text + " ";
    }).join(" ").trim();

    transcriptionDataSRT = data.map((d, index) => 
        `${index + 1}\n${d.timestamp}\n${d.text.trim()}\n`
    ).join("\n");
}

function displayTranscription(format) {
    const contentId = format === 'text' ? 'textContent' : 'srtContent';
    const content = format === 'text' ? transcriptionDataText : transcriptionDataSRT;
    
    // Hide all tab content
    document.querySelectorAll('.tabcontent').forEach(tab => {
        tab.style.display = 'none';
    });
    
    // Show selected tab and update content
    const selectedTab = document.getElementById(format + 'Tab');
    if (selectedTab) {
        selectedTab.style.display = 'block';
        const contentElement = document.getElementById(contentId);
        if (contentElement) {
            contentElement.textContent = content;
        }
    }
}

function openTab(evt, tabName) {
    // Update tab buttons
    document.querySelectorAll('.tablinks').forEach(btn => {
        btn.classList.remove('active');
    });
    evt.currentTarget.classList.add('active');
    
    // Display content
    const format = evt.currentTarget.getAttribute('data-format');
    displayTranscription(format);
}

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

function restartProcess() {
    closeModal('modal4');
    document.getElementById('audioFile').value = '';
    document.getElementById('fileName').textContent = 'לא נבחר קובץ';
    document.getElementById('uploadBtn').disabled = true;
    openModal('modal1');
    
    // Reset state
    transcriptionDataText = '';
    transcriptionDataSRT = '';
    cumulativeOffset = 0;
}
