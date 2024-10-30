// Global variables
let transcriptionDataText = '';
let transcriptionDataSRT = '';
const MAX_CHUNK_SIZE = 25 * 1024 * 1024; // 25MB
const API_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
let cumulativeOffset = 0;

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

// Audio Processing Functions
async function splitFileIntoChunks(file) {
    if (file.size <= MAX_CHUNK_SIZE) return [file];

    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    const chunkDuration = 60; // seconds per chunk
    const sampleRate = audioBuffer.sampleRate;
    const chunksCount = Math.ceil(audioBuffer.duration / chunkDuration);
    const chunks = [];

    for (let i = 0; i < chunksCount; i++) {
        const startTime = i * chunkDuration;
        const endTime = Math.min((i + 1) * chunkDuration, audioBuffer.duration);
        const chunkSamples = (endTime - startTime) * sampleRate;
        
        const chunkBuffer = new AudioContext().createBuffer(
            audioBuffer.numberOfChannels,
            chunkSamples,
            sampleRate
        );

        for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
            const channelData = audioBuffer.getChannelData(channel);
            const newData = channelData.slice(
                Math.floor(startTime * sampleRate),
                Math.floor(endTime * sampleRate)
            );
            chunkBuffer.getChannelData(channel).set(newData);
        }

        const blob = await audioBufferToBlob(chunkBuffer);
        chunks.push(blob);
    }

    return chunks;
}

async function audioBufferToBlob(audioBuffer) {
    const offlineCtx = new OfflineAudioContext(
        audioBuffer.numberOfChannels,
        audioBuffer.length,
        audioBuffer.sampleRate
    );

    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineCtx.destination);
    source.start();

    const renderedBuffer = await offlineCtx.startRendering();
    const wav = audioBufferToWav(renderedBuffer);
    return new Blob([wav], { type: 'audio/wav' });
}

function audioBufferToWav(buffer) {
    const numChannels = buffer.numberOfChannels;
    const length = buffer.length * numChannels * 2;
    const arrayBuffer = new ArrayBuffer(44 + length);
    const view = new DataView(arrayBuffer);
    
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + length, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, buffer.sampleRate, true);
    view.setUint32(28, buffer.sampleRate * numChannels * 2, true);
    view.setUint16(32, numChannels * 2, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, 'data');
    view.setUint32(40, length, true);

    const channels = [];
    for (let i = 0; i < numChannels; i++) {
        channels.push(buffer.getChannelData(i));
    }

    let offset = 44;
    for (let i = 0; i < buffer.length; i++) {
        for (let channel = 0; channel < numChannels; channel++) {
            const sample = Math.max(-1, Math.min(1, channels[channel][i]));
            view.setInt16(offset, sample * 0x7FFF, true);
            offset += 2;
        }
    }

    return arrayBuffer;
}

function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

async function sendChunkToAPI(chunk, apiKey) {
    const formData = new FormData();
    formData.append('file', chunk);
    formData.append('model', 'whisper-large-v3-turbo');
    formData.append('response_format', 'verbose_json');
    formData.append('language', 'he');

    const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}` },
        body: formData
    });

    if (!response.ok) {
        if (response.status === 401) {
            localStorage.removeItem('groqApiKey');
            throw new Error('Invalid API key');
        }
        throw new Error(`API Error: ${response.status}`);
    }

    const result = await response.json();
    console.log('API Response:', result);
    return result;
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
    cumulativeOffset = 0;
    
    try {
        const chunks = await splitFileIntoChunks(file);
        const totalChunks = chunks.length;
        let combinedText = '';
        let allSegments = [];

        for (let i = 0; i < totalChunks; i++) {
            const progressPercent = ((i + 1) / totalChunks) * 100;
            updateProgress(progressPercent);
            
            const response = await sendChunkToAPI(chunks[i], apiKey);
            
            if (response.segments) {
                const adjustedSegments = response.segments.map(segment => ({
                    ...segment,
                    start: segment.start + cumulativeOffset,
                    end: segment.end + cumulativeOffset
                }));
                allSegments = allSegments.concat(adjustedSegments);
                
                if (adjustedSegments.length > 0) {
                    cumulativeOffset += chunks[i].duration || chunkDuration;
                }
                
                combinedText += response.text + ' ';
            }
        }

        transcriptionDataText = combinedText.trim();
        generateSRTFormat({ segments: allSegments });
        showResults();

    } catch (error) {
        console.error('Error:', error);
        handleError(error);
    } finally {
        closeModal('modal3');
    }
}

function updateProgress(percent) {
    document.getElementById('progress').style.width = `${percent}%`;
    document.getElementById('progressText').textContent = `${Math.round(percent)}%`;
}

function handleError(error) {
    if (error.message === 'Invalid API key') {
        alert('שגיאה במפתח API. נא להזין מפתח חדש.');
        location.reload();
    } else {
        alert('שגיאה בתהליך התמלול. נא לנסות שוב.');
    }
}

function generateSRTFormat(result) {
    if (!result.segments || result.segments.length === 0) {
        if (transcriptionDataText) {
            transcriptionDataSRT = `1\n00:00:00,000 --> ${formatTimestamp(30)}\n${transcriptionDataText}\n`;
        } else {
            transcriptionDataSRT = '';
        }
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
    
    transcriptionDataText = '';
    transcriptionDataSRT = '';
    cumulativeOffset = 0;
}
