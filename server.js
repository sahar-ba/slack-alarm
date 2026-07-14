const express = require('express');
const crypto = require('crypto');
const path = require('path');

const app = express();
app.use(express.json({
    verify: (req, res, buf) => { req.rawBody = buf; }
}));
app.use(express.static(path.join(__dirname, 'public')));

// ── Configuration (variables d'environnement sur Render) ──
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const PUSHCUT_WEBHOOK_URL = process.env.PUSHCUT_WEBHOOK_URL; // URL webhook Pushcut
const SERVER_BASE_URL = process.env.SERVER_BASE_URL; // ex: https://votre-app.onrender.com
// ────────────────────────────────────────────────────────

// ── Route 1 : Page d'alarme ──────────────────────────────
app.get('/alarm', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'alarm.html'));
});

// ── Route 2 : Événements Slack ───────────────────────────
app.post('/slack/events', async (req, res) => {
    const body = req.body;

    // Vérification URL Slack
    if (body.type === 'url_verification') {
        return res.send(body.challenge);
    }

    // Vérification signature
    if (!verifySlackSignature(req)) {
        return res.status(401).send('Signature invalide');
    }

    res.status(200).send();

    const event = body.event;
    if (!event || event.subtype === 'bot_message') return;

    await handleSlackEvent(event);
});

async function handleSlackEvent(event) {
    const channel = event.channel || 'inconnu';
    const text = (event.text || 'Nouveau message').slice(0, 100);

    console.log(`Message Slack reçu dans ${channel}: ${text}`);

    // Construire l'URL de la page d'alarme avec le message et canal en paramètres
    const alarmUrl = `${SERVER_BASE_URL}/alarm?message=${encodeURIComponent(text)}&channel=${encodeURIComponent(channel)}`;

    // Envoyer la notification Pushcut qui ouvre la page d'alarme
    await triggerPushcut(alarmUrl, channel, text);
}

// ── Déclencher Pushcut pour ouvrir la page d'alarme ─────
async function triggerPushcut(alarmUrl, channel, text) {
    try {
        const response = await fetch(PUSHCUT_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: '🚨 ALERTE SLACK',
                text: `${channel}: ${text}`,
                sound: 'vibes',         // son Pushcut en plus
                isTimeSensitive: true,  // passe le mode Ne pas déranger
                actions: [
                    {
                        name: '⛔ Ouvrir l\'alarme',
                        url: alarmUrl,  // ouvre directement la page d'alarme dans Safari
                    }
                ],
                defaultAction: {
                    name: 'Ouvrir alarme',
                    url: alarmUrl,      // tap sur la notif = ouvre la page d'alarme
                }
            })
        });

        if (response.ok) {
            console.log('Pushcut déclenché avec succès → page alarme:', alarmUrl);
        } else {
            console.error('Erreur Pushcut:', response.status, await response.text());
        }
    } catch (err) {
        console.error('Erreur réseau Pushcut:', err.message);
    }
}

// ── Route de test ────────────────────────────────────────
app.get('/test', async (req, res) => {
    const alarmUrl = `${SERVER_BASE_URL}/alarm?message=Ceci+est+un+test&channel=%23test`;
    await triggerPushcut(alarmUrl, '#test', 'Ceci est un test');
    res.send(`Test envoyé ! Vérifiez Pushcut sur votre iPhone.<br><br>Ou ouvrez directement la page d'alarme : <a href="${alarmUrl}">${alarmUrl}</a>`);
});

// ── Health check ─────────────────────────────────────────
app.get('/health', (req, res) => {
    res.json({ status: 'actif', timestamp: new Date().toISOString() });
});

// ── Vérification signature Slack ─────────────────────────
function verifySlackSignature(req) {
    const timestamp = req.headers['x-slack-request-timestamp'];
    const slackSignature = req.headers['x-slack-signature'];
    if (!timestamp || !slackSignature) return false;

    const time = Math.floor(Date.now() / 1000);
    if (Math.abs(time - timestamp) > 300) return false;

    const sigBasestring = `v0:${timestamp}:${req.rawBody}`;
    const mySignature = 'v0=' + crypto
        .createHmac('sha256', SLACK_SIGNING_SECRET)
        .update(sigBasestring, 'utf8')
        .digest('hex');

    try {
        return crypto.timingSafeEqual(
            Buffer.from(mySignature, 'utf8'),
            Buffer.from(slackSignature, 'utf8')
        );
    } catch {
        return false;
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Serveur démarré sur le port ${PORT}`);
});
