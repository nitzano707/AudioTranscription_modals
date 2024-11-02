// משתנים גלובליים לאחסון התמלול בפורמטים שונים
let transcriptionDataText = '';
let transcriptionDataSRT = '';
const defaultLanguage = 'he'; // שפה ברירת מחדל - עברית

const maxChunkSizeMB = 3; // משתנה גלובלי להגדרת גודל המקטע המקסימלי של קובץ האודיו במגה-בייט
const maxChunkSizeBytes = maxChunkSizeMB * 1024 * 1024;
let segmentCounter = 1; // מספר רציף של מקטעים
let cumulativeTime = 0; // זמן מצטבר לכל המקטעים

// הסתרת אזור הזנת API או הצגת אזור העלאת קובץ וכפתור התחל תהליך
document.addEventListener('DOMContentLoaded', () => {
    const apiKey = localStorage.getItem('groqApiKey');

    if (!apiKey) {
        document.getElementById('apiRequest').style.display = 'block';
    } else {
        document.getElementById('apiRequest').style.display = 'none';
        document.getElementById('startProcessBtn').style.display = 'block';
    }

    document.getElementById('textTab').style.display = 'block';
    document.querySelector("button[onclick*='textTab']").classList.add('active');
    displayTranscription('text');
});

// פונקציה לשמירת מפתח ה-API
function saveApiKey() {
    const apiKeyInput = document.getElementById('apiKeyInput').value;
    if (apiKeyInput) {
        localStorage.setItem('groqApiKey', apiKeyInput);
        document.getElementById('apiRequest').style.display = 'none';
        document.getElementById('startProcessBtn').style.display = 'block';
    }
}

// העלאת קובץ אודיו והתחלת תהליך פיצול ותמלול
async function uploadAudio() {
    const apiKey = localStorage.getItem('groqApiKey');
    if (!apiKey) {
        alert('מפתח API חסר. נא להזין מחדש.');
        return;
    }

    openModal('modal3');
    const audioFile = document.getElementById('audioFile').files[0];
    if (!audioFile) {
        alert('אנא בחר קובץ להעלאה.');
        closeModal('modal3');
        return;
    }

    try {
        console.log("Starting to split the audio file into chunks...");
        const chunks = splitAudioBySize(audioFile);
        const totalChunks = chunks.length;
        console.log(`Total chunks created: ${totalChunks}`);

        let transcriptionData = [];
        for (let i = 0; i < totalChunks; i++) {
            console.log("Uploading chunk", i + 1, "of", totalChunks);
            document.getElementById('progress').style.width = `${Math.round(((i + 1) / totalChunks) * 100)}%`;
            document.getElementById('progressText').textContent = `${Math.round(((i + 1) / totalChunks) * 100)}%`;

            const transcription = await processAudioChunk(chunks[i], i + 1);
            transcriptionData.push(...transcription);

            await new Promise(resolve => setTimeout(resolve, 500));
        }

        saveTranscriptions(transcriptionData, audioFile.name);
        console.log("All chunks processed, saving transcriptions.");
        displayTranscription('text');

        closeModal('modal3');
        openModal('modal4');
    } catch (error) {
        console.error('Error during audio processing:', error);
        alert('שגיאה במהלך התמלול. נא לנסות שוב.');
        closeModal('modal3');
    }
}

// פונקציה לפיצול קובץ האודיו למקטעים בהתאם למגבלה
function splitAudioBySize(audioFile) {
    const chunks = [];
    let start = 0;

    while (start < audioFile.size) {
        const end = Math.min(start + maxChunkSizeBytes, audioFile.size);
        const chunk = audioFile.slice(start, end);
        chunks.push(new File([chunk], `chunk_${chunks.length + 1}.${audioFile.name.split('.').pop()}`, { type: audioFile.type }));
        start = end;
    }

    return chunks;
}

// פונקציה לעיבוד מקטע אודיו בודד
async function processAudioChunk(chunk, chunkNumber) {
    const formData = new FormData();
    formData.append('file', chunk);
    formData.append('model', 'whisper-large-v3-turbo');
    formData.append('response_format', 'verbose_json');
    formData.append('language', defaultLanguage);

    const apiKey = localStorage.getItem('groqApiKey');
    if (!apiKey) {
        alert('מפתח API חסר. נא להזין שוב.');
        location.reload();
        return [];
    }

    try {
        console.log(`Sending chunk ${chunkNumber} to the API...`);
        const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`
            },
            body: formData
        });

        if (response.ok) {
            const data = await response.json();
            console.log(`Received response for chunk ${chunkNumber}:`, data);
            return formatTranscription(data);
        } else {
            if (response.status === 401) {
                alert('שגיאה במפתח API. נא להזין מפתח חדש.');
                localStorage.removeItem('groqApiKey');
                location.reload();
                return [];
            }
            const errorText = await response.text();
            throw new Error(`Error for chunk ${chunkNumber}: ${errorText}`);
        }
    } catch (error) {
        console.error(`Failed to upload chunk ${chunkNumber}:`, error);
        alert(`Failed to upload chunk ${chunkNumber}: ${error.message}`);
        return [];
    }
}

// פונקציה לעיצוב תמלול
function formatTranscription(transcription) {
    const segments = transcription.segments;
    let formattedTranscription = [];

    segments.forEach((segment) => {
        const { start, end, text } = segment;
        formattedTranscription.push({
            text: text.trim(),
            timestamp: `${formatTimestamp(cumulativeTime + start)} --> ${formatTimestamp(cumulativeTime + end)}`
        });
        segmentCounter++;
    });

    cumulativeTime += transcription.duration;
    return formattedTranscription;
}

// פונקציה לשמירת התמלולים
function saveTranscriptions(data, audioFileName) {
    transcriptionDataText = data.map((d) => {
        if (/[.?!]$/.test(d.text.trim())) {
            return cleanText(d.text);
        } else {
            return cleanText(d.text) + " ";
        }
    }).join("").trim();

    transcriptionDataSRT = data.map((d, index) => {
        return `${index + 1}\n${d.timestamp}\n${cleanText(d.text)}\n`;
    }).join("\n\n");

    console.log("Transcription data saved successfully:", transcriptionDataText);
}

// פונקציה לעיצוב חותמות זמן
function formatTimestamp(seconds) {
    const date = new Date(seconds * 1000);
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    const secs = String(date.getUTCSeconds()).padStart(2, '0');
    const millis = String(date.getUTCMilliseconds()).padStart(3, '0');

    return `${hours}:${minutes}:${secs},${millis}`;
}

// פונקציה לניקוי טקסט
function cleanText(text) {
    return text.replace(/\s+/g, ' ').trim();
}

// פונקציה להצגת התמלול בפורמט המבוקש
function displayTranscription(format) {
    console.log("Displaying transcription in format:", format);
    let transcriptionResult;
    if (format === "text") {
        transcriptionResult = document.getElementById('textContent');
    } else if (format === "srt") {
        transcriptionResult = document.getElementById('srtContent');
    }

    if (!transcriptionResult) {
        console.error('Invalid tab name or element not found:', format);
        return;
    }

    // ווידוא שהכרטיסיה הרלוונטית מוצגת
    const tabcontent = document.getElementsByClassName("tabcontent");
    for (let i = 0; i < tabcontent.length; i++) {
        tabcontent[i].style.display = "none";
    }

    if (format === "text") {
        transcriptionResult.textContent = transcriptionDataText;
    } else if (format === "srt") {
        transcriptionResult.textContent = transcriptionDataSRT;
    }

    transcriptionResult.parentElement.style.display = "block";
    console.log("Transcription displayed successfully.");
}

// פונקציה לפתיחת מודאל
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    modal.style.display = 'block';
    document.body.classList.add('modal-open');
}

// פונקציה לסגירת מודאל
function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    modal.style.display = 'none';
    document.body.classList.remove('modal-open');
}
