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

// File Processing Functions
async function splitFileIntoChunks(file) {
    if (file.size <= MAX_CHUNK_SIZE) {
        return [file];
    }

    const totalChunks = Math.ceil(file.size / MAX_CHUNK_SIZE);
    const chunks = [];
    
    for (let i = 0; i < totalChunks; i++) {
        const start = i * MAX_CHUNK_SIZE;
        const end = Math.min(start + MAX_CHUNK_SIZE, file.size);
        chunks.push(file.slice(start, end));
    }
    
    return chunks;
}

async function sendChunkToAPI(chunk, apiKey) {
    const formData = new FormData();
    formData.append('file', chunk);
    formData.append('model', 'whisper-large-v3-turbo');
    formData.append('response_format', 'json');
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

    return await response.json();
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
    cumulativeOffset = 0; // Reset offset for new file
    
    try {
        const chunks = await splitFileIntoChunks(file);
        const totalChunks = chunks.length;
        let combinedText = '';
        let allSegments = [];

        for (let i = 0; i < totalChunks; i++) {
            const progressPercent = ((i + 1) / totalChunks) * 100;
            updateProgress(progressPercent);
            
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
                    
                    if (adjustedSegments.length > 0) {
                        cumulativeOffset += adjustedSegments[adjustedSegments.length - 1].end;
                    }
                }
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
    const progress = document.getElementById('progress');
    const progressText = document.getElementById('progressText');
    if (progress && progressText) {
        progress.style.width = `${percent}%`;
        progressText.textContent = `${Math.round(percent)}%`;
    }
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
        // אם אין segments, נחלק את הטקסט למשפטים
        if (transcriptionDataText) {
            const sentences = transcriptionDataText.match(/[^.!?]+[.!?]+/g) || [transcriptionDataText];
            const sentenceLength = 3; // אורך ממוצע של משפט בשניות
            
            transcriptionDataSRT = sentences.map((sentence, index) => {
                const startTime = formatTimestamp(index * sentenceLength);
                const endTime = formatTimestamp((index + 1) * sentenceLength);
                return `${index + 1}\n${startTime} --> ${endTime}\n${sentence.trim()}\n`;
            }).join('\n');
        } else {
            transcriptionDataSRT = '';
        }
        return;
    }

    // אם יש segments, נשתמש בהם
    transcriptionDataSRT = result.segments.map((segment, index) => {
        const sentences = segment.text.match(/[^.!?]+[.!?]+/g) || [segment.text];
        const timePerSentence = (segment.end - segment.start) / sentences.length;
        
        return sentences.map((sentence, sentenceIndex) => {
            const startTime = formatTimestamp(segment.start + (sentenceIndex * timePerSentence));
            const endTime = formatTimestamp(segment.start + ((sentenceIndex + 1) * timePerSentence));
            return `${index + sentenceIndex + 1}\n${startTime} --> ${endTime}\n${sentence.trim()}\n`;
        }).join('\n');
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
    
    // Hide all tab content
    document.querySelectorAll('.tabcontent').forEach(tab => {
        tab.style.display = 'none';
        tab.classList.remove('active');
    });
    
    // Show selected tab and update content
    const selectedTab = document.getElementById(format + 'Tab');
    const contentElement = document.getElementById(contentId);
    
    if (selectedTab && contentElement) {
        selectedTab.style.display = 'block';
        selectedTab.classList.add('active');
        contentElement.textContent = content;
        console.log(`Displaying ${format} content:`, content); // Debug log
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
    
    // Reset state
    transcriptionDataText = '';
    transcriptionDataSRT = '';
    cumulativeOffset = 0;
}
