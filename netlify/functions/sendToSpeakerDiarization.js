const fetch = require('node-fetch');

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: 'Method Not Allowed'
        };
    }

    try {
        const { mediaUrl } = JSON.parse(event.body);
        const apiKey = event.headers['pyannote-api-key'];

        const response = await fetch('https://api.pyannote.ai/v1/diarize', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                url: mediaUrl,
                numSpeakers: 2,
                confidence: true
            })
        });

        if (response.ok) {
            const data = await response.json();
            return {
                statusCode: 200,
                body: JSON.stringify({ jobId: data.jobId })
            };
        } else {
            const errorText = await response.text();
            throw new Error(`Error: ${errorText}`);
        }
    } catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};
