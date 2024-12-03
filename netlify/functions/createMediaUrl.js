async function createMediaUrl(apiKey) {
    try {
        const response = await fetch('/.netlify/functions/createMediaUrl', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'pyannote-api-key': apiKey
            }
        });
        if (response.ok) {
            const data = await response.json();
            return data.uploadUrl;
        }
    } catch (error) {
        console.error('Error creating media URL:', error);
    }
}

async function sendToSpeakerDiarization(mediaUrl, apiKey) {
    try {
        const response = await fetch('/.netlify/functions/sendToSpeakerDiarization', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'pyannote-api-key': apiKey
            },
            body: JSON.stringify({ mediaUrl })
        });
        if (response.ok) {
            const data = await response.json();
            return data.jobId;
        }
    } catch (error) {
        console.error('Error sending to PyAnnote:', error);
    }
}

async function getDiarizationResult(jobId, apiKey) {
    try {
        let response = await fetch('/.netlify/functions/getDiarizationResult', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'pyannote-api-key': apiKey
            },
            body: JSON.stringify({ jobId })
        });

        while (response.status === 202) {
            await new Promise(resolve => setTimeout(resolve, 5000));  // המתנה של 5 שניות
            response = await fetch('/.netlify/functions/getDiarizationResult', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'pyannote-api-key': apiKey
                },
                body: JSON.stringify({ jobId })
            });
        }

        if (response.ok) {
            return await response.json();
        }
    } catch (error) {
        console.error('Error fetching PyAnnote result:', error);
    }
}
