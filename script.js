// Constants and Global Variables
const MAX_CHUNK_SIZE = 25 * 1024 * 1024;
const API_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
let transcriptionDataText = '';
let transcriptionDataSRT = '';
let cumulativeOffset = 0;

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    const apiKey = localStorage.getItem('groqApiKey');
    document.getElementById('apiRequest').style.display = apiKey ? 'none' : 'block';
    document.getElementById('startProcessBtn').style.display = apiKey ? 'block' : 'none';
    initializeTabs();
});

function initializeTabs() {
    const textTab = document.getElementById('textTab');
    if (textTab) {
        textTab.style.display = 'block';
        document.querySelector("[data-format='text']")?.classList.add('active');
    }
}

// API Key Management
function saveApiKey() {
    const apiKey = document.getElementById('apiKeyInput').value.trim();
    if (apiKey) {
        localStorage.setItem('groqApiKey', apiKey);
        document.getElementById('apiRequest').style.display = 'none';
        document.getElementById('startProcessBtn').style.display = 'block';
    }
}

// File Upload Management
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

// Audio Processing
async function splitFileIntoChunks(file) {
    if (file.size <= MAX_CHUNK_SIZE) {
        return [file];
    }

    const chunks = [];
    let start = 0;
    
    while (start < file.size) {
        const end = Math.min(start + MAX_CHUNK_SIZE, file.size);
        const chunk = file.slice(start, end);
        // יוצרים קובץ חדש עם הפורמט המקורי
        const newFile = new File([chunk], `chunk_${chunks.length}.mp3`, {
            type: file.type
        });
        chunks.push(newFile);
        start = end;
    }

    return chunks;
}

async function bufferToWavBlob(audioBuffer) {
    const numChannels = audioBuffer.numberOfChannels;
    const length = audioBuffer.length * numChannels * 2;
    const buffer = new ArrayBuffer(44 + length);
    const view = new DataView(buffer);

    writeWavHeader(view, {
        numChannels,
        sampleRate: audioBuffer.sampleRate,
        length
    });

    const channelsData = Array.from({ length: numChannels }, (_, i) =>
        audioBuffer.getChannelData(i));

    let offset = 44;
    for (let i = 0; i < audioBuffer.length; i++) {
        for (let channel = 0; channel < numChannels; channel++) {
            const sample = Math.max(-1, Math.min(1, channelsData[channel][i]));
            view.setInt16(offset, sample * 0x7fff, true);
            offset += 2;
        }
    }

    return new Blob([buffer], { type: 'audio/wav' });
}

function writeWavHeader(view, { numChannels, sampleRate, length }) {
    const writeString = (offset, string) => {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + length, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * 2, true);
    view.setUint16(32, numChannels * 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, length, true);
}

// API Communication
async function sendChunkToAPI(chunk, apiKey) {
    const formData = new FormData();
    formData.append('file', chunk);
    formData.append('model', 'whisper-large-v3-turbo');
    formData.append('response_format', 'verbose_json');
    formData.append('language', 'he');

    try {
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
            const errorText = await response.text();
            console.error('API Error Response:', errorText);
            throw new Error(`API Error: ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        console.error('API Error:', error);
        throw error;
    }
}

// Main Processing
async function uploadAudio() {
    const apiKey = localStorage.getItem('groqApiKey');
    const file = document.getElementById('audioFile').files[0];
    
    if (!apiKey || !file) {
        alert(!apiKey ? 'מפתח API חסר. נא להזין מחדש.' : 'אנא בחר קובץ להעלאה.');
        return;
    }

    openModal('modal3');
    resetTranscriptionData();

    try {
        const chunks = await splitFileIntoChunks(file);
        await processChunks(chunks, apiKey);
        showResults();
    } catch (error) {
        console.error('Processing Error:', error);
        handleError(error);
    } finally {
        closeModal('modal3');
    }
}

async function processChunks(chunks, apiKey) {
    let combinedText = '';
    let allSegments = [];
    
    for (let i = 0; i < chunks.length; i++) {
        updateProgress(((i + 1) / chunks.length) * 100);
        
        const response = await sendChunkToAPI(chunks[i], apiKey);
        if (response.text) {
            combinedText += response.text + ' ';
            
            if (response.segments) {
                const adjustedSegments = response.segments.map(segment => ({
                    ...segment,
                    start: segment.start + cumulativeOffset,
                    end: segment.end + cumulativeOffset
                }));
                
                allSegments = allSegments.concat(adjustedSegments);
                const lastSegment = adjustedSegments[adjustedSegments.length - 1];
                if (lastSegment) {
                    cumulativeOffset = lastSegment.end;
                }
            }
        }
    }

    transcriptionDataText = combinedText.trim();
    generateSRTFormat({ segments: allSegments });
}

// Progress and Error Handling
function updateProgress(percent) {
    const progress = document.getElementById('progress');
    const progressText = document.getElementById('progressText');
    if (progress && progressText) {
        progress.style.width = `${percent}%`;
        progressText.textContent = `${Math.round(percent)}%`;
    }
}

function handleError(error) {
    console.error('Error details:', error);
    if (error.message.includes('Invalid API key')) {
        alert('שגיאה במפתח API. נא להזין מפתח חדש.');
        location.reload();
    } else {
        alert('שגיאה בתהליך התמלול. נא לנסות שוב.');
    }
}

// Transcription Format Generation
function generateSRTFormat(result) {
    if (!result.segments?.length) {
        transcriptionDataSRT = transcriptionDataText ? 
            `1\n00:00:00,000 --> ${formatTimestamp(30)}\n${transcriptionDataText}\n` : 
            '';
        return;
    }

    transcriptionDataSRT = result.segments.map((segment, index) => 
        `${index + 1}\n${formatTimestamp(segment.start)} --> ${formatTimestamp(segment.end)}\n${segment.text.trim()}\n`
    ).join('\n');
}

function formatTimestamp(seconds) {
    if (typeof seconds !== 'number' || isNaN(seconds)) return '00:00:00,000';
    
    const date = new Date(seconds * 1000);
    return [
        String(date.getUTCHours()).padStart(2, '0'),
        String(date.getUTCMinutes()).padStart(2, '0'),
        String(date.getUTCSeconds()).padStart(2, '0')
    ].join(':') + ',' + String(date.getUTCMilliseconds()).padStart(3, '0');
}

// Display Management
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
        console.log(`Displaying ${format} content:`, content);
    }
}

function openTab(evt, tabName) {
    document.querySelectorAll('.tablinks').forEach(btn => btn.classList.remove('active'));
    evt.currentTarget.classList.add('active');
    displayTranscription(evt.currentTarget.getAttribute('data-format'));
}

// File Download
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

// Reset Functions
function resetTranscriptionData() {
    transcriptionDataText = '';
    transcriptionDataSRT = '';
    cumulativeOffset = 0;
}

function restartProcess() {
    closeModal('modal4');
    document.getElementById('audioFile').value = '';
    document.getElementById('fileName').textContent = 'לא נבחר קובץ';
    document.getElementById('uploadBtn').disabled = true;
    openModal('modal1');
    resetTranscriptionData();
}
