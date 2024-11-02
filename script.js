// משתנים גלובליים לאחסון התמלול בפורמטים שונים
let transcriptionDataText = '';
let transcriptionDataSRT = '';
const defaultLanguage = 'he'; // שפה ברירת מחדל - עברית

document.addEventListener('DOMContentLoaded', () => {
    const apiKey = localStorage.getItem('groqApiKey');

    // הסתרת אזור הזנת API או הצגת אזור העלאת קובץ וכפתור התחל תהליך
    if (!apiKey) {
        document.getElementById('apiRequest').style.display = 'block';
    } else {
        document.getElementById('apiRequest').style.display = 'none';
        document.getElementById('startProcessBtn').style.display = 'block';
    }

    // הגדרת ברירת המחדל להצגת תמלול כטקסט
    document.getElementById('textTab').style.display = 'block';
    document.querySelector("button[onclick*='textTab']").classList.add('active');
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
    const audioFileInput = document.getElementById('audioFile');
    audioFileInput.click();
}

document.getElementById('audioFile').addEventListener('change', function () {
    const fileName = this.files[0] ? this.files[0].name : "לא נבחר קובץ";
    document.getElementById('fileName').textContent = fileName;

    const uploadBtn = document.getElementById('uploadBtn');
    if (this.files[0]) {
        uploadBtn.disabled = false;
    } else {
        uploadBtn.disabled = true;
    }
});

function openModal(modalId) {
    const modal = document.getElementById(modalId);
    modal.style.display = 'block';
    document.body.classList.add('modal-open');
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    modal.style.display = 'none';
    document.body.classList.remove('modal-open');
}

async function uploadAudio() {
    const apiKey = localStorage.getItem('groqApiKey');
    if (!apiKey) {
        alert('מפתח API חסר. נא להזין מחדש.');
        return;
    }

    openModal('modal3');
    console.log("Progress modal opened.");

    const audioFile = document.getElementById('audioFile').files[0];
    if (!audioFile) {
        alert('אנא בחר קובץ להעלאה.');
        closeModal('modal3');
        return;
    }

    // לוג התחלת עיבוד
    const fileType = audioFile.name.split('.').pop().toLowerCase();
    const fileSizeInMB = (audioFile.size / (1024 * 1024)).toFixed(2);
    const processingStartTime = Date.now();
    console.log(`[PROCESSING_START] File Type: ${fileType}, Size: ${fileSizeInMB}MB, Start Time: ${new Date(processingStartTime).toISOString()}`);

    const maxChunkSizeMB = 24;
    const maxChunkSizeBytes = maxChunkSizeMB * 1024 * 1024;
    let transcriptionData = [];
    let totalTimeElapsed = 0;

    try {
        console.log("Starting to split the audio file into chunks...");
        const chunks = await splitAudioToChunksBySize(audioFile, maxChunkSizeBytes);
        const totalChunks = chunks.length;
        console.log(`Total chunks created: ${totalChunks}`);

        for (let i = 0; i < totalChunks; i++) {
            console.log(`Processing chunk ${i + 1} of ${totalChunks}`);
            console.log(`Current total time elapsed: ${totalTimeElapsed}`);

            const progressPercent = Math.round(((i + 1) / totalChunks) * 100);
            document.getElementById('progress').style.width = `${progressPercent}%`;
            document.getElementById('progressText').textContent = `${progressPercent}%`;

            const chunkDuration = await processAudioChunk(chunks[i], transcriptionData, i + 1, totalChunks, totalTimeElapsed);
            
            if (typeof chunkDuration === 'number' && chunkDuration > 0) {
                totalTimeElapsed += chunkDuration;
                console.log(`Chunk ${i + 1} duration: ${chunkDuration}`);
                console.log(`Updated total time elapsed: ${totalTimeElapsed}`);
            } else {
                console.warn(`Invalid chunk duration received for chunk ${i + 1}: ${chunkDuration}`);
            }

            await new Promise(resolve => setTimeout(resolve, 500));
        }

        // מיון התמלול לפי חותמות זמן לוודא סדר נכון
        transcriptionData.sort((a, b) => {
            const timeA = a.timestamp.split(' -->')[0].trim();
            const timeB = b.timestamp.split(' -->')[0].trim();
            return timeA.localeCompare(timeB);
        });

        saveTranscriptions(transcriptionData, audioFile.name);
        console.log("All chunks processed, saving transcriptions.");
        displayTranscription('text');
        console.log("Displaying transcription.");

        // לוג סיום עיבוד
        const processingEndTime = Date.now();
        const totalProcessingTime = processingEndTime - processingStartTime;
        console.log(`[PROCESSING_END] File Type: ${fileType}, Size: ${fileSizeInMB}MB, Total Time: ${totalProcessingTime}ms (${(totalProcessingTime/1000).toFixed(2)} seconds), Speed: ${(fileSizeInMB/(totalProcessingTime/1000)).toFixed(2)}MB/s`);

        closeModal('modal3');
        openModal('modal4');

    } catch (error) {
        console.error('Error during audio processing:', error);
        // לוג שגיאה
        const processingEndTime = Date.now();
        console.log(`[PROCESSING_ERROR] File Type: ${fileType}, Size: ${fileSizeInMB}MB, Time Until Error: ${processingEndTime - processingStartTime}ms`);
        alert('שגיאה במהלך התמלול. נא לנסות שוב.');
        closeModal('modal3');
    }
}

async function splitAudioToChunksBySize(file, maxChunkSizeBytes) {
    // אם הקובץ קטן מהגודל המרבי, החזר אותו במקטע אחד
    if (file.size <= maxChunkSizeBytes) {
        return [file];
    }

    console.log(`Splitting file: ${file.name}, Total size: ${(file.size / (1024 * 1024)).toFixed(2)}MB into ${maxChunkSizeBytes / (1024 * 1024)}MB chunks`);
    
    const chunks = [];
    let start = 0;

    while (start < file.size) {
        const end = Math.min(start + maxChunkSizeBytes, file.size);
        const chunk = file.slice(start, end);
        
        // יצירת קובץ חדש עם אותו סוג ושם מתאים למספר המקטע
        const chunkFile = new File(
            [chunk], 
            `chunk_${chunks.length + 1}.${file.name.split('.').pop()}`, 
            { type: file.type }
        );
        
        console.log(`Created chunk ${chunks.length + 1}, Size: ${(chunkFile.size / (1024 * 1024)).toFixed(2)}MB`);
        
        chunks.push(chunkFile);
        start = end;
    }

    console.log(`Split complete. Created ${chunks.length} chunks`);
    return chunks;
}

async function processAudioChunk(chunk, transcriptionData, currentChunk, totalChunks, totalTimeElapsed) {
    const formData = new FormData();
    formData.append('file', chunk);
    formData.append('model', 'whisper-large-v3-turbo');
    formData.append('response_format', 'verbose_json');
    formData.append('language', defaultLanguage);

    const apiKey = localStorage.getItem('groqApiKey');
    if (!apiKey) {
        alert('מפתח API חסר. נא להזין שוב.');
        location.reload();
        return;
    }

    try {
        console.log(`Sending chunk ${currentChunk} of ${totalChunks} to the API...`);
        const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`
            },
            body: formData
        });

        if (response.ok) {
            const data = await response.json();
            console.log(`Received response for chunk ${currentChunk}:`, data);
            
            if (data.segments) {
                // מחשב את משך הזמן של המקטע הנוכחי
                const chunkDuration = data.duration || 0;
                console.log(`Chunk ${currentChunk} duration:`, chunkDuration);
                console.log(`Total time before this chunk:`, totalTimeElapsed);

                data.segments.forEach((segment, index) => {
                    if (typeof segment.start === 'number' && typeof segment.end === 'number') {
                        // מוסיף את הזמן המצטבר לחותמות הזמן
                        const adjustedStart = segment.start + totalTimeElapsed;
                        const adjustedEnd = segment.end + totalTimeElapsed;
                        
                        console.log(`Segment ${index} original times:`, segment.start, segment.end);
                        console.log(`Segment ${index} adjusted times:`, adjustedStart, adjustedEnd);

                        const startTime = formatTimestamp(adjustedStart);
                        const endTime = formatTimestamp(adjustedEnd);
                        const text = segment.text.trim();

                        transcriptionData.push({
                            text: text,
                            timestamp: `${startTime} --> ${endTime}`
                        });
                    } else {
                        console.warn(`Invalid timestamp for segment ${index}:`, segment);
                    }
                });

                // עדכון הזמן המצטבר עם משך הזמן של המקטע הנוכחי
                return chunkDuration;
            } else {
                console.warn(`Missing segments in response for chunk ${currentChunk}`);
                return 0;
            }
        } else {
            if (response.status === 401) {
                alert('שגיאה במפתח API. נא להזין מפתח חדש.');
                localStorage.removeItem('groqApiKey');
                location.reload();
                return 0;
            }
            const errorText = await response.text();
            console.error(`Error for chunk ${currentChunk}:`, errorText);
            return 0;
        }
    } catch (error) {
        console.error('Network error:', error);
        return 0;
    }
}

function formatTimestamp(seconds) {
    if (typeof seconds !== 'number' || isNaN(seconds)) {
        console.error('Invalid seconds value for timestamp:', seconds);
        return '00:00:00,000';
    }
    const date = new Date(seconds * 1000);
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    const secs = String(date.getUTCSeconds()).padStart(2, '0');
    const millis = String(date.getUTCMilliseconds()).padStart(3, '0');

    return `${hours}:${minutes}:${secs},${millis}`;
}

function cleanText(text) {
    return text.replace(/\s+/g, ' ').trim();
}

function saveTranscriptions(data, audioFileName) {
    transcriptionDataText = data.map((d, index) => {
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

function openTab(evt, tabName) {
    const tabcontent = document.getElementsByClassName("tabcontent");
    for (let i = 0; i < tabcontent.length; i++) {
        tabcontent[i].style.display = "none";
    }
    const tablinks = document.getElementsByClassName("tablinks");
    for (let i = 0; i < tablinks.length; i++) {
        tablinks[i].className = tablinks[i].className.replace(" active", "");
    }
    document.getElementById(tabName).style.display = "block";
    evt.currentTarget.className += " active";
    
    const format = evt.currentTarget.getAttribute('data-format');
    displayTranscription(format);
}

function downloadTranscription() {
    const activeTab = document.querySelector(".tablinks.active");
    if (!activeTab) {
        alert('לא נבחר פורמט להורדה. נא לבחור פורמט תמלול.');
        return;
    }
    const format = activeTab.getAttribute('data-format');
    let blob, fileName;

    if (format === "text") {
        if (!transcriptionDataText) {
            alert('אין תמלול להורדה.');
            return;
        }
        blob = new Blob([transcriptionDataText], { type: 'text/plain' });
        fileName = 'transcription.txt';
    } else if (format === "srt") {
        if (!transcriptionDataSRT) {
            alert('אין תמלול להורדה.');
            return;
        }
        blob = new Blob([transcriptionDataSRT], { type: 'text/plain' });
        fileName = 'transcription.srt';
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function restartProcess() {
    closeModal('modal4');
    closeModal('modal3');
    document.getElementById('audioFile').value = "";
    document.getElementById('fileName').textContent = "לא נבחר קובץ";
    document.getElementById('uploadBtn').disabled = true;
    openModal('modal1');
}
