const fetch = require('node-fetch');

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: 'Method Not Allowed'
        };
    }

    try {
        const { jobId } = JSON.parse(event.body);
        const apiKey = event.headers['pyannote-api-key'];

        const response = await fetch(`https://api.pyannote.ai/v1/jobs/${jobId}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`
            }
        });

        if (response.ok) {
            const data = await response.json();
            if (data.status === 'succeeded') {
                return {
                    statusCode: 200,
                    body: JSON.stringify(data.output.diarization)
                };
            } else {
                return {
                    statusCode: 202,
                    body: JSON.stringify({ status: data.status })
                };
            }
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
