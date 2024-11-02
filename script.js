// משתנים גלובליים לאחסון התמלול בפורמטים שונים
let transcriptionDataText = '';
let transcriptionDataSRT = '';
let transcriptionResult = { segments: [] };
const defaultLanguage = 'he'; // שפת ברירת מחדל - עברית
const maxChunkSizeBytes = 24 * 1024 * 1024;
let apiKey = localStorage.getItem('groqApiKey');
let audioSource = null; // מקור האודיו

document.addEventListener('DOMContentLoaded', () => {
    if (!apiKey) {
        showPopup('apiKeyPopup');
    } else {
        document.getElementById('startProcessBtn').style.display = 'block';
    }
    displayTranscription('text');
});

function saveApiKey() {
    const inputApiKey = document.getElementById('apiKeyInput').value.trim();
    if (inputApiKey) {
        localStorage.setItem('groqApiKey', inputApiKey);
        apiKey = inputApiKey;
        showMessage('ה-API Key נשמר בהצלחה!');
        document.getElementById('apiKeyPopup').style.display = 'none';
    } else {
        showMessage('אנא הזן API Key תקין');
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

    openModal('modal3');
    let audioFile = document.getElementById('audioFile').files[0];
    if (!audioFile) return alert('אנא בחר קובץ להעלאה.');

    showMessage('מתחיל תמלול...', 0);
    document.getElementById('loader').style.display = 'block';
    document.getElementById('transcribeButton').disabled = true;

    try {
        if (audioFile.size > maxChunkSizeBytes) {
            const audioChunks = await splitAudioFile(audioFile);
            transcriptionResult = { segments: [] };
            for (let i = 0; i < audioChunks.length; i++) {
                showMessage(`מתמלל חלק ${i + 1} מתוך ${audioChunks.length}...`, 0);
                const chunkResult = await transcribeChunk(audioChunks[i]);
                transcriptionResult.segments = transcriptionResult.segments.concat(chunkResult.segments);
            }
        } else {
            transcriptionResult = await transcribeChunk(audioFile);
        }
        updateTranscription();
        showTab('srt');
        showMessage('התמלול הושלם בהצלחה!');
    } catch (error) {
        console.error('שגיאה בתמלול:', error);
        showMessage('אירעה שגיאה בתמלול. אנא בדוק את ה-API Key שלך ונסה שוב.');
        localStorage.removeItem('groqApiKey');
        apiKey = null;
    } finally {
        document.getElementById('loader').style.display = 'none';
        document.getElementById('transcribeButton').disabled = false;
    }
}

async function transcribeChunk(chunk) {
    const formData = new FormData();
    formData.append('file', chunk);
    formData.append('model', 'whisper-large-v3-turbo');
    formData.append('response_format', 'verbose_json');
    formData.append('language', defaultLanguage);

    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
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

async function splitAudioFile(file) {
    const chunks = Math.ceil(file.size / maxChunkSizeBytes);
    const audioChunks = [];

    for (let i = 0; i < chunks; i++) {
        const start = i * maxChunkSizeBytes;
        const end = Math.min((i + 1) * maxChunkSizeBytes, file.size);
        const chunk = file.slice(start, end);
        audioChunks.push(new File([chunk], `chunk_${i + 1}.${file.name.split('.').pop()}`, { type: file.type }));
    }

    return audioChunks;
}

function updateTranscription() {
    if (!transcriptionResult) {
        console.log('אין תוצאות תמלול זמינות');
        return;
    }

    const wordsPerSubtitle = parseInt(document.getElementById('wordsPerSubtitle').value) || 8;
    
    if (transcriptionResult.segments && transcriptionResult.segments.length > 0) {
        let srtFormat = '';
        let plainText = '';
        let subtitleIndex = 1;
        transcriptionResult.segments.forEach((segment) => {
            const subtitles = splitIntoSubtitles(segment.text, segment.start, segment.end, wordsPerSubtitle);
            subtitles.forEach((subtitle) => {
                srtFormat += `${subtitleIndex}\n`;
                srtFormat += `${formatTime(subtitle.start)} --> ${formatTime(subtitle.end)}\n`;
                srtFormat += `${subtitle.text}\n\n`;
                plainText += subtitle.text + ' ';
                subtitleIndex++;
            });
        });
        document.getElementById('srtTranscription').innerHTML = `<pre>${srtFormat}</pre>`;
        document.getElementById('plainTextTranscription').textContent = plainText.trim();
        
        document.getElementById('srtContent').style.display = 'block';
        document.getElementById('plainTextContent').style.display = 'none';
        showTab('srt');
    } else {
        document.getElementById('srtTranscription').innerHTML = '<p>לא התקבל תמלול או שהתמלול ריק</p>';
        document.getElementById('plainTextTranscription').textContent = 'לא התקבל תמלול או שהתמלול ריק';
    }
}

function formatTime(seconds) {
    const date = new Date(seconds * 1000);
    const hours = date.getUTCHours().toString().padStart(2, '0');
    const minutes = date.getUTCMinutes().toString().padStart(2, '0');
    const secs = date.getUTCSeconds().toString().padStart(2, '0');
    const ms = date.getUTCMilliseconds().toString().padStart(3, '0');
    return `${hours}:${minutes}:${secs},${ms}`;
}

function splitIntoSubtitles(text, startTime, endTime, maxWords) {
    const words = text.split(' ');
    const subtitles = [];
    let currentSubtitle = { text: '', start: startTime };
    let wordCount = 0;

    words.forEach((word, index) => {
        currentSubtitle.text += word + ' ';
        wordCount++;

        if (wordCount === maxWords || index === words.length - 1) {
            const progress = (index + 1) / words.length;
            currentSubtitle.end = startTime + (endTime - startTime) * progress;
            subtitles.push({...currentSubtitle, text: currentSubtitle.text.trim()});

            if (index < words.length - 1) {
                currentSubtitle = { text: '', start: currentSubtitle.end };
                wordCount = 0;
            }
        }
    });

    return subtitles;
}

function showTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(content => content.style.display = 'none');
    document.querySelectorAll('.tab-button').forEach(button => button.classList.remove('active'));
    
    document.getElementById(`${tabName}Content`).style.display = 'block';
    document.querySelector(`.tab-button[onclick="showTab('${tabName}')"]`).classList.add('active');
}

function showPopup(popupId) {
    document.getElementById(popupId).style.display = 'flex';
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
