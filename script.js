// משתנים גלובליים לאחסון התמלול בפורמטים שונים
let transcriptionDataText = '';
let transcriptionDataSRT = '';
const defaultLanguage = 'he'; // שפת ברירת מחדל - עברית
const maxChunkSizeMB = 8; // גודל מקטע מרבי במגה-בייט
const maxChunkSizeBytes = maxChunkSizeMB * 1024 * 1024;

document.addEventListener('DOMContentLoaded', () => {
    const apiKey = localStorage.getItem('groqApiKey');
    document.getElementById(apiKey ? 'startProcessBtn' : 'apiRequest').style.display = 'block';
    document.getElementById('textTab').style.display = 'block';
    displayTranscription('text');
});

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

document.getElementById('audioFile').addEventListener('change', function () {
    const fileName = this.files[0] ? this.files[0].name : "לא נבחר קובץ";
    document.getElementById('fileName').textContent = fileName;
    document.getElementById('uploadBtn').disabled = !this.files[0];
});

async function uploadAudio() {
    console.log("User initiated upload:", new Date().toISOString());
    const apiKey = localStorage.getItem('groqApiKey');
    if (!apiKey) return alert('מפתח API חסר. נא להזין מחדש.');

    openModal('modal3'); // הצגת מודאל התקדמות
    const audioFile = document.getElementById('audioFile').files[0];
    if (!audioFile) return alert('אנא בחר קובץ להעלאה.');

    // המרה ל-WAV עבור MP3 או M4A
    if (audioFile.type === 'audio/mp3' || audioFile.type === 'audio/m4a') {
        console.log("Converting file to WAV format...");
        audioFile = await convertToWav(audioFile);
        console.log("File converted to WAV format:", new Date().toISOString());
    }

    console.log("Starting file split:", new Date().toISOString());
    const chunks = await splitAudioToChunksBySize(audioFile, maxChunkSizeBytes);
    console.log("File split completed:", new Date().toISOString());

    let transcriptionData = [];
    let totalTimeElapsed = 0;

    for (let i = 0; i < chunks.length; i++) {
        console.log(`Uploading chunk ${i + 1} of ${chunks.length}:`, new Date().toISOString());
        await processAudioChunk(chunks[i], transcriptionData, i + 1, chunks.length, totalTimeElapsed);
        totalTimeElapsed += chunks[i].duration || 0;
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    saveTranscriptions(transcriptionData);
    displayTranscription('text');
    closeModal('modal3');
    openModal('modal4');
    console.log("Final transcription displayed to user:", new Date().toISOString());
}

async function convertToWav(file) {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    const wavBlob = bufferToWaveBlob(audioBuffer);
    return new File([wavBlob], `${file.name.split('.')[0]}.wav`, { type: 'audio/wav' });
}

async function splitAudioToChunksBySize(file, maxChunkSizeBytes) {
    if (file.size <= maxChunkSizeBytes) return [file];

    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    const sampleRate = audioBuffer.sampleRate;
    const numChannels = audioBuffer.numberOfChannels;
    const chunkDuration = audioBuffer.duration / Math.ceil(file.size / maxChunkSizeBytes);
    let currentTime = 0;
    const chunks = [];

    while (currentTime < audioBuffer.duration) {
        const end = Math.min(currentTime + chunkDuration, audioBuffer.duration);
        const frameCount = Math.floor((end - currentTime) * sampleRate);
        const chunkBuffer = audioContext.createBuffer(numChannels, frameCount, sampleRate);

        for (let channel = 0; channel < numChannels; channel++) {
            chunkBuffer.copyToChannel(audioBuffer.getChannelData(channel).slice(currentTime * sampleRate, end * sampleRate), channel);
        }

        chunks.push(bufferToWaveBlob(chunkBuffer));
        currentTime = end;
    }
    return chunks;
}

function bufferToWaveBlob(abuffer) {
    const numOfChan = abuffer.numberOfChannels;
    const length = abuffer.length * numOfChan * 2 + 44;
    const buffer = new ArrayBuffer(length);
    const view = new DataView(buffer);
    let pos = 0;

    function setUint16(data) { view.setUint16(pos, data, true); pos += 2; }
    function setUint32(data) { view.setUint32(pos, data, true); pos += 4; }

    setUint32(0x46464952); // "RIFF"
    setUint32(length - 8); // file length - 8
    setUint32(0x45564157); // "WAVE"
    setUint32(0x20746d66); // "fmt " chunk
    setUint32(16);         // PCM format
    setUint16(1);          // format (PCM)
    setUint16(numOfChan);
    setUint32(abuffer.sampleRate);
    setUint32(abuffer.sampleRate * 2 * numOfChan);
    setUint16(numOfChan * 2);
    setUint16(16);

    setUint32(0x61746164); // "data" chunk
    setUint32(length - pos - 4);

    for (let i = 0; i < abuffer.numberOfChannels; i++) {
        const channelData = abuffer.getChannelData(i);
        for (let j = 0; j < channelData.length; j++) {
            const sample = Math.max(-1, Math.min(1, channelData[j]));
            view.setInt16(pos, sample < 0 ? sample * 32768 : sample * 32767, true);
            pos += 2;
        }
    }

    return new Blob([buffer], { type: "audio/wav" });
}

async function processAudioChunk(chunk, transcriptionData, currentChunk, totalChunks, totalTimeElapsed) {
    const formData = new FormData();
    formData.append('file', chunk);
    formData.append('model', 'whisper-large-v3-turbo');
    formData.append('response_format', 'verbose_json'); 
    formData.append('language', defaultLanguage); 

    const apiKey = localStorage.getItem('groqApiKey');
    if (!apiKey) return alert('מפתח API חסר. נא להזין שוב.');

    try {
        const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}` },
            body: formData
        });

        if (response.ok) {
            const data = await response.json();
            data.segments.forEach(segment => {
                if (segment.start !== undefined && segment.end !== undefined) {
                    transcriptionData.push({
                        text: segment.text.trim(),
                        timestamp: `${formatTimestamp(segment.start + totalTimeElapsed)} --> ${formatTimestamp(segment.end + totalTimeElapsed)}`
                    });
                }
            });
        } else {
            console.error(`Error for chunk ${currentChunk}: ${response.statusText}`);
        }
    } catch (error) {
        console.error('Network error:', error);
    }
}

function formatTimestamp(seconds) {
    const date = new Date(seconds * 1000);
    return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}:${String(date.getUTCSeconds()).padStart(2, '0')},${String(date.getUTCMilliseconds()).padStart(3, '0')}`;
}

function saveTranscriptions(data) {
    transcriptionDataText = data.map(d => d.text).join(" ").trim();
    transcriptionDataSRT = data.map((d, i) => `${i + 1}\n${d.timestamp}\n${d.text}`).join("\n\n");
}

function displayTranscription(format) {
    const transcriptionResult = document.getElementById(format === "text" ? 'textContent' : 'srtContent');
    transcriptionResult.textContent = format === "text" ? transcriptionDataText : transcriptionDataSRT;
    transcriptionResult.parentElement.style.display = "block";
}

function openModal(modalId) {
    document.getElementById(modalId).style.display = 'block';
    document.body.classList.add('modal-open');
}

function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
    document.body.classList.remove('modal-open');
}

function restartProcess() {
    closeModal('modal4');
    closeModal('modal3');
    document.getElementById('audioFile').value = "";
    document.getElementById('fileName').textContent = "לא נבחר קובץ";
    document.getElementById('uploadBtn').disabled = true;
    openModal('modal1');
}
