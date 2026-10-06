let currentPosition = null;
let speedHistory = [];
let speedFilteredHistory = [];
let accelerationHistory = [];
let accelerationFilteredHistory = [];
let timeHistory = [];
let speedChart = null;
let accelerationChart = null;
const gauges = {};             // jauges dessinées nativement : total, lon, lat
let gMeterPeakMax = 0;         // record accélération longitudinale (g)
let gMeterPeakMin = 0;         // record freinage (g)
let gaugeAnimScheduled = false;
let currentMaxDataPoints = 60;

// --- Suivi GPS ---
let lastSpeedMs = null;         // dernière vitesse connue (m/s)
let lastGpsTime = null;         // timestamp GPS du dernier échantillon
let lastClockTime = null;       // horloge du navigateur du dernier échantillon
let lastLat = null;
let lastLon = null;
let accelBuffer = [];          // lissage court pour l'aiguille
let emaAccel = null;           // accélération filtrée (moyenne exponentielle)
let emaSpeed = null;           // vitesse filtrée (moyenne exponentielle)
let latAccelEma = null;        // accélération latérale filtrée (m/s²)
let lastHeadingRad = null;     // dernier cap GPS (radians)

const MAX_HISTORY = 600; // Garde jusqu'à 600 points d'historique (~10 min à 1 échantillon/s)
const FILTER_TAU = 2.5; // Constante de temps du filtre d'accélération (s)
const LAT_TAU = 1.5; // Constante de temps du filtre d'accélération latérale (s)
const GRAVITY = 9.81; // Pesanteur (m/s²)
const G_METER_MIN = -1.5; // Plage d'affichage du G-mètre (en g)
const G_METER_MAX = 1.5;
const REPO_OWNER = "Rege78";
const REPO_NAME = "OnBoard";

// Récupérer le numéro de commit depuis l'API GitHub
async function getCommitHash() {
    try {
        const response = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/commits?per_page=1`);
        if (!response.ok) throw new Error('Erreur API GitHub');

        const commits = await response.json();
        if (commits.length > 0) {
            return commits[0].sha.substring(0, 7); // Retourne les 7 premiers caractères
        }
    } catch (error) {
        console.warn("Impossible de récupérer le numéro de commit:", error);
    }
    return "unknown";
}

// Distance entre deux points GPS (formule de haversine, en mètres)
function haversineMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000; // rayon terrestre (m)
    const toRad = (d) => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const sinLat = Math.sin(dLat / 2);
    const sinLon = Math.sin(dLon / 2);
    const a = sinLat * sinLat +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * sinLon * sinLon;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function updateSpeed() {
    if (!("geolocation" in navigator)) {
        const speedEl = document.getElementById("speed");
        if (speedEl) speedEl.textContent = "N/A";
        return;
    }

    navigator.geolocation.watchPosition(
        (position) => {
            const coords = position.coords;
            const clockNow = Date.now();
            const gpsTime = position.timestamp;

            // --- Durée entre deux échantillons, robuste face aux timestamps GPS farfelus ---
            // (certains navigateurs embarqués renvoient un timestamp identique ou incohérent ;
            //  on retombe alors sur l'horloge du navigateur)
            let dt = null;
            if (lastClockTime !== null) {
                const dtClock = (clockNow - lastClockTime) / 1000;
                const dtGps = (lastGpsTime !== null) ? (gpsTime - lastGpsTime) / 1000 : null;
                if (dtGps !== null && dtGps > 0.1 && dtGps < 5) {
                    dt = dtGps;
                } else if (dtClock > 0.1 && dtClock < 10) {
                    dt = dtClock;
                }
            }

            // Zone morte : en dessous de ~2 km/h, le GPS « bruite » autour de zéro.
            // On force la vitesse à 0 pour obtenir des jauges calmes à l'arrêt.
            if (speed !== null && speed !== undefined && speed < 0.6) {
                speed = 0;
                speedSource = "stop";
            }

            // --- Vitesse (m/s) : celle du GPS, sinon distance parcourue / durée ---
            let speed = coords.speed;
            let speedSource = "gps";
            if ((speed === null || speed === undefined) && lastLat !== null && dt !== null) {
                const dist = haversineMeters(lastLat, lastLon, coords.latitude, coords.longitude);
                const v = dist / dt;
                if (v >= 0 && v < 100) { // garde-fou : moins de 360 km/h
                    speed = v;
                    speedSource = "dist";
                }
            }

            if (speed !== null && speed !== undefined) {
                const speedKmh = Math.round(speed * 3.6);
                const speedEl = document.getElementById("speed");
                if (speedEl) speedEl.textContent = speedKmh;

                // --- Accélération réelle : variation de vitesse / durée écoulée (m/s²) ---
                let acceleration = null;
                if (lastSpeedMs !== null && dt !== null) {
                    acceleration = (speed - lastSpeedMs) / dt;
                    // À l'arrêt ou presque : pas de micro-variations parasites
                    if (speed < 0.6 && lastSpeedMs < 0.6) acceleration = 0;
                }
                lastSpeedMs = speed;

                // Recalage des filtres à l'arrêt : retour progressif à zéro
                if (speed < 0.6) {
                    if (emaAccel !== null) emaAccel = emaAccel * 0.5;
                    if (latAccelEma !== null) latAccelEma = latAccelEma * 0.5;
                }

                // Mise à jour de l'historique
                const now = new Date();
                const timeLabel = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

                // Filtre passe-bas (moyenne exponentielle) : courbe lissée, légèrement retardée,
                // mais débarrassée du bruit GPS. alpha s'adapte à l'intervalle réel entre 2 échantillons.
                if (acceleration !== null && dt !== null) {
                    const alpha = 1 - Math.exp(-dt / FILTER_TAU);
                    emaAccel = (emaAccel === null) ? acceleration : emaAccel + alpha * (acceleration - emaAccel);
                }

                // Accélération latérale : vitesse × variation de cap / durée (m/s²)
                let lateralAccel = null;
                if (coords.heading !== null && lastHeadingRad !== null && dt !== null) {
                    const headingRad = coords.heading * Math.PI / 180;
                    let dTheta = headingRad - lastHeadingRad;
                    dTheta = ((dTheta + Math.PI * 3) % (Math.PI * 2)) - Math.PI; // repliement -π..π
                    const candidate = speed * (dTheta / dt);
                    if (Math.abs(candidate) < 30) lateralAccel = candidate; // garde-fou
                    // À l'arrêt, le cap GPS tourne au gré du bruit : on force zéro
                    if (speed < 0.6) lateralAccel = 0;
                }
                lastHeadingRad = (coords.heading !== null) ? coords.heading * Math.PI / 180 : null;
                if (lateralAccel !== null && dt !== null) {
                    const alphaLat = 1 - Math.exp(-dt / LAT_TAU);
                    latAccelEma = (latAccelEma === null) ? lateralAccel : latAccelEma + alphaLat * (lateralAccel - latAccelEma);
                }

                speedHistory.push(speedKmh);

                // Vitesse filtrée (moyenne exponentielle, même principe que l'accélération)
                if (dt !== null) {
                    const alphaSpeed = 1 - Math.exp(-dt / FILTER_TAU);
                    emaSpeed = (emaSpeed === null) ? speed : emaSpeed + alphaSpeed * (speed - emaSpeed);
                }
                speedFilteredHistory.push(emaSpeed !== null ? Math.round(emaSpeed * 3.6) : null);

                accelerationHistory.push(acceleration !== null ? Math.round(acceleration * 10) / 10 : null);
                accelerationFilteredHistory.push(emaAccel !== null ? Math.round(emaAccel * 10) / 10 : null);
                timeHistory.push(timeLabel);

                // Limiter l'historique complet
                if (speedHistory.length > MAX_HISTORY) {
                    speedHistory.shift();
                    speedFilteredHistory.shift();
                    accelerationHistory.shift();
                    accelerationFilteredHistory.shift();
                    timeHistory.shift();
                }

                // Mise à jour des graphiques et du G-mètre
                updateCharts();
                updateGMeter(acceleration, lateralAccel, speed, dt, speedSource);
            } else {
                // Perte de vitesse GPS : réinitialisation pour éviter les faux pics
                lastSpeedMs = null;
            }

            lastLat = coords.latitude;
            lastLon = coords.longitude;
            lastGpsTime = gpsTime;
            lastClockTime = clockNow;

            currentPosition = coords;
            updateDetailsDisplay();
        },
        (error) => {
            console.error("Erreur de géolocalisation : ", error);
            const speedEl = document.getElementById("speed");
            if (speedEl) speedEl.textContent = "N/A";
        },
        {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 5000
        }
    );
}

function updateDetailsDisplay() {
    if (!currentPosition) return;

    const lat = currentPosition.latitude.toFixed(6);
    const lon = currentPosition.longitude.toFixed(6);
    const alt = currentPosition.altitude !== null ? `${currentPosition.altitude.toFixed(1)} m` : "--";
    const accuracy = currentPosition.accuracy !== null ? `${Math.round(currentPosition.accuracy)} m` : "--";
    const altAccuracy = currentPosition.altitudeAccuracy !== null ? `${currentPosition.altitudeAccuracy.toFixed(1)} m` : "--";
    const heading = currentPosition.heading !== null ? `${Math.round(currentPosition.heading)}°` : "--";

    const latEl = document.getElementById("detail-lat");
    const lonEl = document.getElementById("detail-lon");
    const altEl = document.getElementById("detail-alt");
    const accuracyEl = document.getElementById("detail-accuracy");
    const altAccuracyEl = document.getElementById("detail-alt-accuracy");
    const headingEl = document.getElementById("detail-heading");

    if (latEl) latEl.textContent = lat;
    if (lonEl) lonEl.textContent = lon;
    if (altEl) altEl.textContent = alt;
    if (accuracyEl) accuracyEl.textContent = accuracy;
    if (altAccuracyEl) altAccuracyEl.textContent = altAccuracy;
    if (headingEl) headingEl.textContent = heading;
}

function getVisibleData() {
    // Retourne les N derniers points selon la sélection
    const startIndex = Math.max(0, speedHistory.length - currentMaxDataPoints);
    return {
        labels: timeHistory.slice(startIndex),
        speed: speedHistory.slice(startIndex),
        speedFiltered: speedFilteredHistory.slice(startIndex),
        acceleration: accelerationHistory.slice(startIndex),
        filtered: accelerationFilteredHistory.slice(startIndex)
    };
}

function initCharts() {
    const speedCtx = document.getElementById("speedChart");
    const accelerationCtx = document.getElementById("accelerationChart");

    if (!speedCtx || !accelerationCtx) return;

    // Hauteur fixe pour que les deux graphiques tiennent à l'écran du véhicule
    speedCtx.style.height = "260px";
    speedCtx.style.width = "100%";
    accelerationCtx.style.height = "260px";
    accelerationCtx.style.width = "100%";

    const visibleData = getVisibleData();

    // Graphique Vitesse
    speedChart = new Chart(speedCtx, {
        type: 'line',
        data: {
            labels: visibleData.labels,
            datasets: [
                {
                    label: '💨 Vitesse (km/h)',
                    data: visibleData.speed,
                    borderColor: 'rgb(255, 45, 45)',
                    backgroundColor: 'rgba(255, 45, 45, 0.1)',
                    borderWidth: 2,
                    tension: 0.3,
                    fill: true
                },
                {
                    label: '🌀 Vitesse filtrée (km/h)',
                    data: visibleData.speedFiltered,
                    borderColor: 'rgb(0, 191, 255)',
                    backgroundColor: 'rgba(0, 191, 255, 0.05)',
                    borderWidth: 2,
                    tension: 0.4,
                    fill: false,
                    spanGaps: true,
                    borderDash: [6, 3],
                    pointRadius: 0
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    position: 'top',
                    align: 'end',
                    labels: {
                        color: 'rgba(255, 255, 255, 0.8)',
                        font: { size: 12 }
                    }
                }
            },
            scales: {
                x: {
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)'
                    },
                    ticks: {
                        color: 'rgba(255, 255, 255, 0.6)',
                        font: { size: 10 }
                    }
                },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    title: {
                        display: true,
                        text: 'Vitesse (km/h)',
                        color: 'rgb(255, 45, 45)'
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)'
                    },
                    ticks: {
                        color: 'rgb(255, 45, 45)',
                        font: { size: 10 }
                    }
                }
            }
        }
    });

    // Graphique Accélération (m/s²)
    accelerationChart = new Chart(accelerationCtx, {
        type: 'line',
        data: {
            labels: visibleData.labels,
            datasets: [
                {
                    label: '⚡ Accélération (m/s²)',
                    data: visibleData.acceleration,
                    borderColor: 'rgb(255, 204, 0)',
                    backgroundColor: 'rgba(255, 204, 0, 0.1)',
                    borderWidth: 2,
                    tension: 0.3,
                    fill: true,
                    spanGaps: true
                },
                {
                    label: '🌀 Accélération filtrée (m/s²)',
                    data: visibleData.filtered,
                    borderColor: 'rgb(0, 191, 255)',
                    backgroundColor: 'rgba(0, 191, 255, 0.05)',
                    borderWidth: 2,
                    tension: 0.4,
                    fill: false,
                    spanGaps: true,
                    borderDash: [6, 3],
                    pointRadius: 0
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    position: 'top',
                    align: 'end',
                    labels: {
                        color: 'rgba(255, 255, 255, 0.8)',
                        font: { size: 12 }
                    }
                }
            },
            scales: {
                x: {
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)'
                    },
                    ticks: {
                        color: 'rgba(255, 255, 255, 0.6)',
                        font: { size: 10 }
                    }
                },
                y: {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    title: {
                        display: true,
                        text: 'Accélération (m/s²)',
                        color: 'rgb(255, 204, 0)'
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)'
                    },
                    ticks: {
                        color: 'rgb(255, 204, 0)',
                        font: { size: 10 }
                    }
                }
            }
        }
    });
}

function updateCharts() {
    if (!speedChart || !accelerationChart) return;

    const visibleData = getVisibleData();

    speedChart.data.labels = visibleData.labels;
    speedChart.data.datasets[0].data = visibleData.speed;
    speedChart.data.datasets[1].data = visibleData.speedFiltered;
    speedChart.update('none');

    accelerationChart.data.labels = visibleData.labels;
    accelerationChart.data.datasets[0].data = visibleData.acceleration;
    accelerationChart.data.datasets[1].data = visibleData.filtered;
    accelerationChart.update('none');
}

// --- Jauges (dessin natif, sans librairie externe) ---

function createGauge(canvas, min, max, leftLabel, rightLabel) {
    // Résolution interne fixe : le CSS se charge de la mise à l'échelle
    canvas.width = 300;
    canvas.height = 300;
    return {
        ctx: canvas.getContext("2d"),
        min,
        max,
        leftLabel,
        rightLabel,
        display: 0,
        target: 0
    };
}

function buildGaugeCard(canvasId, valueId) {
    const card = document.createElement("div");
    card.className = "gauge-card";

    const wrapper = document.createElement("div");
    wrapper.className = "gauge-wrapper";
    wrapper.style.width = "170px";
    wrapper.style.height = "170px";

    const canvas = document.createElement("canvas");
    canvas.id = canvasId;
    canvas.className = "gauge-canvas";
    wrapper.appendChild(canvas);

    const value = document.createElement("div");
    value.id = valueId;
    value.className = "gauge-value";
    value.style.color = "#ffffff";
    value.textContent = "0.00g";
    wrapper.appendChild(value);

    card.appendChild(wrapper);
    return { card, canvas, value };
}

function moveTitleBelowGauge(card, title, subtitle) {
    // Retire le titre d'origine (caché par le dépassement de la jauge) et le
    // recrée sous la jauge, en position flux normal
    const h3 = card.querySelector("h3");
    if (h3) h3.remove();
    if (card.querySelector(".gauge-title")) return;

    const t = document.createElement("p");
    t.className = "gauge-title";
    t.textContent = title;
    t.style.margin = "14px 0 0 0";
    t.style.fontSize = "1.05rem";
    t.style.fontWeight = "600";
    t.style.color = "var(--secondary, #ffcc00)";
    t.style.textAlign = "center";
    if (subtitle) t.dataset.subtitle = subtitle;
    card.appendChild(t);
}

function initGMeter() {
    const canvas = document.getElementById("gMeterGauge");
    if (!canvas || !canvas.getContext) return;

    // Jauge principale réduite : elle affiche désormais le g total (norme)
    const mainWrapper = canvas.closest(".gauge-wrapper");
    if (mainWrapper) {
        mainWrapper.style.width = "170px";
        mainWrapper.style.height = "170px";
    }
    const mainCard = canvas.closest(".gauge-card");
    if (mainCard) {
        moveTitleBelowGauge(mainCard, "⚡ G total");
    }
    const totalValueEl = document.getElementById("gMeterValue");
    if (totalValueEl) totalValueEl.style.color = "#ffffff";

    gauges.total = createGauge(canvas, -2, 2, null, null);

    // Jauges dédiées : longitudinale et latérale
    const container = document.querySelector(".gauges-container");
    if (container) {
        const lon = buildGaugeCard("gMeterGaugeLon", "gMeterValueLon");
        const lat = buildGaugeCard("gMeterGaugeLat", "gMeterValueLat");
        container.appendChild(lon.card);
        container.appendChild(lat.card);

        moveTitleBelowGauge(lon.card, "⬆️ Longitudinale");
        moveTitleBelowGauge(lat.card, "↔️ Latérale");

        gauges.lon = createGauge(lon.canvas, -1.5, 1.5, "◀ Freinage", "Accél. ▶");
        gauges.lat = createGauge(lat.canvas, -1.5, 1.5, "◀ Gauche", "Droite ▶");

        // Records longitudinaux sous la jauge dédiée
        if (!document.getElementById("gMeterPeaks")) {
            const peaks = document.createElement("p");
            peaks.id = "gMeterPeaks";
            peaks.style.margin = "14px 0 0 0";
            peaks.style.fontSize = "0.95rem";
            peaks.style.color = "var(--secondary, #ffcc00)";
            peaks.style.textAlign = "center";
            peaks.textContent = "Max : +0.00g    Freinage : 0.00g";
            lon.card.appendChild(peaks);
        }
    }

    // Ligne de diagnostic sous la jauge principale
    if (mainCard && !document.getElementById("gMeterDebug")) {
        const debug = document.createElement("p");
        debug.id = "gMeterDebug";
        debug.style.margin = "8px 0 0 0";
        debug.style.fontSize = "0.85rem";
        debug.style.color = "var(--muted, #a7a7a7)";
        debug.style.textAlign = "center";
        debug.textContent = "En attente de données GPS…";
        mainCard.appendChild(debug);
    }

    drawGauges();
}

function updateGMeter(acceleration, lateralAccel, speedMs, dt, speedSource) {
    const totalEl = document.getElementById("gMeterValue");
    const lonEl = document.getElementById("gMeterValueLon");
    const latEl = document.getElementById("gMeterValueLat");
    const debugEl = document.getElementById("gMeterDebug");
    const peaksEl = document.getElementById("gMeterPeaks");

    // Longitudinale (lissée sur les 3 derniers échantillons)
    let gLon = null;
    if (acceleration !== null) {
        accelBuffer.push(acceleration / GRAVITY);
        if (accelBuffer.length > 3) accelBuffer.shift();
        gLon = accelBuffer.reduce((sum, v) => sum + v, 0) / accelBuffer.length;

        if (lonEl) lonEl.textContent = `${gLon >= 0 ? "+" : ""}${gLon.toFixed(2)}g`;

        // Records de la session
        if (gLon > gMeterPeakMax) gMeterPeakMax = gLon;
        if (gLon < gMeterPeakMin) gMeterPeakMin = gLon;
        if (peaksEl) {
            peaksEl.textContent = `Max : +${gMeterPeakMax.toFixed(2)}g    Freinage : ${gMeterPeakMin.toFixed(2)}g`;
        }
    }

    // Latérale (déjà filtrée par moyenne exponentielle)
    const gLat = latAccelEma !== null ? latAccelEma / GRAVITY : null;
    if (gLat !== null && latEl) {
        latEl.textContent = `${gLat >= 0 ? "+" : ""}${gLat.toFixed(2)}g`;
    }

    // Total : norme des deux composantes
    let gTot = gTotSigned;
    if (gTot !== null && totalEl) {
        totalEl.textContent = `${gTot >= 0 ? "+" : ""}${gTot.toFixed(2)}g`;
    }

    // Cibles des aiguilles (bornées à la plage de chaque cadran)
    // G total signé : positif (accélération) à droite, négatif (freinage) à gauche
    let gTotSigned = null;
    if (gLon !== null) {
        gTotSigned = (gLat !== null)
            ? Math.sign(gLon || gLat) * Math.sqrt(gLon * gLon + gLat * gLat)
            : gLon;
    } else if (gLat !== null) {
        gTotSigned = gLat;
    }
    if (gauges.total && gTotSigned !== null) {
        gauges.total.target = Math.min(2, Math.max(-2, gTotSigned));
    }
    if (gauges.lon && gLon !== null) {
        gauges.lon.target = Math.min(G_METER_MAX, Math.max(G_METER_MIN, gLon));
    }
    if (gauges.lat && gLat !== null) {
        gauges.lat.target = Math.min(G_METER_MAX, Math.max(G_METER_MIN, gLat));
    }

    // Ligne de diagnostic : ce que le navigateur fournit réellement
    if (debugEl) {
        debugEl.textContent =
            `v = ${speedMs !== null && speedMs !== undefined ? speedMs.toFixed(1) : "--"} m/s (${speedSource})` +
            ` · Δt = ${dt !== null ? dt.toFixed(2) : "--"} s` +
            ` · a.lon = ${acceleration !== null ? acceleration.toFixed(1) : "--"} m/s²` +
            ` · a.lat = ${latAccelEma !== null ? latAccelEma.toFixed(1) : "--"} m/s²` +
            ` · ${speedHistory.length} échantillons`;
    }

    animateGauges();
}

function animateGauges() {
    const list = [gauges.total, gauges.lon, gauges.lat].filter(Boolean);
    if (list.length === 0) return;

    let pending = false;
    list.forEach((g) => {
        const d = g.target - g.display;
        if (Math.abs(d) < 0.005) {
            g.display = g.target;
        } else {
            g.display += d * 0.3;
            pending = true;
        }
    });

    list.forEach(drawGauge);

    if (!pending || gaugeAnimScheduled) return;
    gaugeAnimScheduled = true;

    // setTimeout plutôt que requestAnimationFrame : les navigateurs embarqués
    // throttlent parfois fortement les animations quand la page n'est pas active
    setTimeout(() => {
        gaugeAnimScheduled = false;
        animateGauges();
    }, 50);
}

function drawGauge(g) {
    const ctx = g.ctx;
    const W = 300, H = 300;
    const cx = 150, cy = 160, R = 120;

    // Angle (radians) : min à gauche (180°), milieu en haut (270°), max à droite (360°)
    const vToAngle = (v) => Math.PI + ((v - g.min) / (g.max - g.min)) * Math.PI;

    ctx.clearRect(0, 0, W, H);

    // Cadran monochrome
    ctx.beginPath();
    ctx.strokeStyle = "#525252";
    ctx.lineWidth = 16;
    ctx.arc(cx, cy, R, vToAngle(g.min), vToAngle(g.max));
    ctx.stroke();

    // Graduations tous les 0.5g
    ctx.font = "12px 'Segoe UI', Tahoma, sans-serif";
    ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const start = Math.ceil(g.min * 2) / 2;
    for (let v = start; v <= g.max + 0.0001; v += 0.5) {
        const a = vToAngle(v);

        ctx.beginPath();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
        ctx.lineWidth = 2;
        ctx.moveTo(cx + Math.cos(a) * (R - 20), cy + Math.sin(a) * (R - 20));
        ctx.lineTo(cx + Math.cos(a) * (R - 12), cy + Math.sin(a) * (R - 12));
        ctx.stroke();

        const label = v === 0 ? "0" : ((v > 0 && g.min < 0) ? "+" + v.toFixed(1) : v.toFixed(1));
        ctx.fillText(label, cx + Math.cos(a) * (R - 38), cy + Math.sin(a) * (R - 38));
    }

    // Repères latéraux éventuels (freinage/accélération, gauche/droite)
    if (g.leftLabel || g.rightLabel) {
        ctx.font = "11px 'Segoe UI', Tahoma, sans-serif";
        ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
        if (g.leftLabel) ctx.fillText(g.leftLabel, cx - 85, cy + 48);
        if (g.rightLabel) ctx.fillText(g.rightLabel, cx + 85, cy + 48);
    }

    // Aiguille
    const a = vToAngle(Math.min(g.max, Math.max(g.min, g.display)));
    ctx.beginPath();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.moveTo(cx - Math.cos(a) * 18, cy - Math.sin(a) * 18);
    ctx.lineTo(cx + Math.cos(a) * (R - 22), cy + Math.sin(a) * (R - 22));
    ctx.stroke();

    // Pivot
    ctx.beginPath();
    ctx.fillStyle = "#1e1e1e";
    ctx.arc(cx, cy, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.stroke();
}

function drawGauges() {
    [gauges.total, gauges.lon, gauges.lat].forEach((g) => {
        if (g) drawGauge(g);
    });
}

function initSidebar() {
    const menuBtn = document.getElementById("menuBtn");
    const sidebar = document.getElementById("sidebar");
    const pagesList = document.getElementById("pagesList");
    const pageTitle = document.getElementById("pageTitle");

    const pages = [
        { id: "speed", label: "💨 Vitesse", title: "Vitesse" },
        { id: "details", label: "📍 Détails GPS", title: "Détails GPS" },
        { id: "graph", label: "📈 Graphiques", title: "Graphiques" },
        { id: "gauges", label: "⚡ G-Mètre", title: "G-Mètre" }
    ];

    pages.forEach((page) => {
        const li = document.createElement("li");
        const btn = document.createElement("button");

        btn.textContent = page.label;
        btn.classList.toggle("active", page.id === "speed");

        btn.addEventListener("click", () => {
            document.querySelectorAll(".page").forEach((p) => {
                p.style.display = "none";
            });

            const target = document.getElementById(`page-${page.id}`);
            if (target) {
                target.style.display = "block";

                // Initialiser les graphiques / jauges à la première ouverture de la page
                if (page.id === "graph" && !speedChart) {
                    setTimeout(initCharts, 100);
                }
                if (page.id === "gauges" && !gauges.total) {
                    setTimeout(initGMeter, 100);
                }
            }

            if (pageTitle) pageTitle.textContent = page.title;

            document.querySelectorAll(".pages-list button").forEach((b) => {
                b.classList.toggle("active", b === btn);
            });

            if (sidebar) {
                sidebar.classList.remove("active");
                sidebar.setAttribute("aria-hidden", "true");
            }
        });

        li.appendChild(btn);
        if (pagesList) pagesList.appendChild(li);
    });

    if (menuBtn && sidebar) {
        menuBtn.addEventListener("click", () => {
            const isVisible = sidebar.classList.toggle("active");
            sidebar.setAttribute("aria-hidden", !isVisible);
        });

        document.addEventListener("click", (event) => {
            const clickedInsideSidebar = sidebar.contains(event.target);
            const clickedOnMenuButton = menuBtn.contains(event.target);

            if (!clickedInsideSidebar && !clickedOnMenuButton) {
                sidebar.classList.remove("active");
                sidebar.setAttribute("aria-hidden", "true");
            }
        });
    }
}

function initDataPointsSelector() {
    // Le sélecteur n'existe pas dans le HTML : on le crée au-dessus des graphiques
    let selector = document.getElementById("dataPointsSelector");
    if (!selector) {
        const graphContainer = document.querySelector(".graph-container");
        if (!graphContainer) return;

        const wrap = document.createElement("div");
        wrap.style.display = "flex";
        wrap.style.justifyContent = "flex-end";
        wrap.style.alignItems = "center";
        wrap.style.gap = "10px";
        wrap.style.marginBottom = "10px";

        const label = document.createElement("label");
        label.textContent = "Durée affichée :";
        label.style.color = "var(--muted, #a7a7a7)";
        label.style.fontSize = "0.95rem";

        selector = document.createElement("select");
        selector.id = "dataPointsSelector";
        selector.style.background = "var(--card, #1e1e1e)";
        selector.style.color = "var(--text, #fff)";
        selector.style.border = "1px solid var(--card-border, rgba(255,255,255,0.08))";
        selector.style.borderRadius = "8px";
        selector.style.padding = "6px 10px";
        selector.style.fontSize = "0.95rem";

        // Durée affichable en points GPS (~1 échantillon/seconde)
        [
            { value: 30, label: "30 s" },
            { value: 60, label: "1 min" },
            { value: 120, label: "2 min" },
            { value: 300, label: "5 min" },
            { value: 600, label: "10 min" }
        ].forEach((opt) => {
            const o = document.createElement("option");
            o.value = String(opt.value);
            o.textContent = opt.label;
            if (opt.value === currentMaxDataPoints) o.selected = true;
            selector.appendChild(o);
        });

        wrap.appendChild(label);
        wrap.appendChild(selector);
        graphContainer.insertBefore(wrap, graphContainer.firstChild);
    }

    selector.addEventListener("change", (e) => {
        currentMaxDataPoints = parseInt(e.target.value);
        updateCharts();
    });
}

function updateTime() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const timeEl = document.getElementById("time");
    if (timeEl) timeEl.textContent = `${hours}:${minutes}`;
}

// Formater la date au format français
function formatDateFR(dateString) {
    const date = new Date(dateString);
    const options = { year: 'numeric', month: 'short', day: 'numeric' };
    return date.toLocaleDateString('fr-FR', options);
}

// Récupérer et afficher le numéro de commit dans le footer
async function updateFooter() {
    try {
        const commitHash = await getCommitHash();
        const footerEl = document.getElementById("footerText");

        if (footerEl) {
            footerEl.textContent = `${commitHash}`;
        }
    } catch (error) {
        console.warn("Impossible de récupérer le numéro de commit:", error);
    }
}

window.addEventListener("load", () => {
    updateSpeed();
    updateTime();
    initSidebar();
    initDataPointsSelector();
    updateFooter();
    setInterval(updateTime, 60000);
});
