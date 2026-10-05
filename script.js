let currentPosition = null;
let speedHistory = [];
let accelerationHistory = [];
let accelerationFilteredHistory = [];
let timeHistory = [];
let speedChart = null;
let accelerationChart = null;
let gMeterCtx = null;          // contexte canvas du G-mètre (dessin natif)
let gMeterDisplay = 0;         // valeur affichée par l'aiguille (lissée)
let gMeterTarget = 0;           // valeur cible de l'aiguille
let gMeterPeakMax = 0;         // record accélération (g)
let gMeterPeakMin = 0;         // record freinage (g)
let gMeterAnimScheduled = false;
let currentMaxDataPoints = 60;

// --- Suivi GPS ---
let lastSpeedMs = null;         // dernière vitesse connue (m/s)
let lastGpsTime = null;         // timestamp GPS du dernier échantillon
let lastClockTime = null;       // horloge du navigateur du dernier échantillon
let lastLat = null;
let lastLon = null;
let accelBuffer = [];          // lissage court pour l'aiguille
let emaAccel = null;           // accélération filtrée (moyenne exponentielle)

const MAX_HISTORY = 120; // Garde jusqu'à 120 points d'historique
const FILTER_TAU = 2.5; // Constante de temps du filtre d'accélération (s)
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
                } else if (dtClock > 0.1 && dtClock < 5) {
                    dt = dtClock;
                }
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
                }
                lastSpeedMs = speed;

                // Mise à jour de l'historique
                const now = new Date();
                const timeLabel = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

                // Filtre passe-bas (moyenne exponentielle) : courbe lissée, légèrement retardée,
                // mais débarrassée du bruit GPS. alpha s'adapte à l'intervalle réel entre 2 échantillons.
                if (acceleration !== null && dt !== null) {
                    const alpha = 1 - Math.exp(-dt / FILTER_TAU);
                    emaAccel = (emaAccel === null) ? acceleration : emaAccel + alpha * (acceleration - emaAccel);
                }

                speedHistory.push(speedKmh);
                accelerationHistory.push(acceleration !== null ? Math.round(acceleration * 10) / 10 : null);
                accelerationFilteredHistory.push(emaAccel !== null ? Math.round(emaAccel * 10) / 10 : null);
                timeHistory.push(timeLabel);

                // Limiter l'historique complet
                if (speedHistory.length > MAX_HISTORY) {
                    speedHistory.shift();
                    accelerationHistory.shift();
                    accelerationFilteredHistory.shift();
                    timeHistory.shift();
                }

                // Mise à jour des graphiques et du G-mètre
                updateCharts();
                updateGMeter(acceleration, speed, dt, speedSource);
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
        acceleration: accelerationHistory.slice(startIndex),
        filtered: accelerationFilteredHistory.slice(startIndex)
    };
}

function initCharts() {
    const speedCtx = document.getElementById("speedChart");
    const accelerationCtx = document.getElementById("accelerationChart");

    if (!speedCtx || !accelerationCtx) return;

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
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
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
            maintainAspectRatio: true,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
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
    speedChart.update('none');

    accelerationChart.data.labels = visibleData.labels;
    accelerationChart.data.datasets[0].data = visibleData.acceleration;
    accelerationChart.data.datasets[1].data = visibleData.filtered;
    accelerationChart.update('none');
}

// --- G-Mètre (dessin natif, sans librairie externe) ---

function initGMeter() {
    const canvas = document.getElementById("gMeterGauge");
    if (!canvas || !canvas.getContext) return;

    // Résolution interne fixe : le CSS se charge de la mise à l'échelle
    canvas.width = 300;
    canvas.height = 300;
    gMeterCtx = canvas.getContext("2d");

    // Ajout dynamique des lignes infos sous le cadran (sans toucher au HTML)
    const card = canvas.closest(".gauge-card");
    if (card) {
        if (!document.getElementById("gMeterPeaks")) {
            const peaks = document.createElement("p");
            peaks.id = "gMeterPeaks";
            peaks.style.margin = "14px 0 0 0";
            peaks.style.fontSize = "0.95rem";
            peaks.style.color = "var(--secondary, #ffcc00)";
            peaks.style.textAlign = "center";
            peaks.textContent = "Max : +0.00g    Freinage : 0.00g";
            card.appendChild(peaks);
        }
        if (!document.getElementById("gMeterDebug")) {
            const debug = document.createElement("p");
            debug.id = "gMeterDebug";
            debug.style.margin = "8px 0 0 0";
            debug.style.fontSize = "0.85rem";
            debug.style.color = "var(--muted, #a7a7a7)";
            debug.style.textAlign = "center";
            debug.textContent = "En attente de données GPS…";
            card.appendChild(debug);
        }
    }

    drawGMeter();
}

function updateGMeter(acceleration, speedMs, dt, speedSource) {
    const valueEl = document.getElementById("gMeterValue");
    const debugEl = document.getElementById("gMeterDebug");
    const peaksEl = document.getElementById("gMeterPeaks");

    if (acceleration !== null) {
        const g = acceleration / GRAVITY;

        if (valueEl) {
            valueEl.textContent = `${g >= 0 ? "+" : ""}${g.toFixed(2)}g`;
        }

        // Records de la session
        if (g > gMeterPeakMax) gMeterPeakMax = g;
        if (g < gMeterPeakMin) gMeterPeakMin = g;
        if (peaksEl) {
            peaksEl.textContent = `Max : +${gMeterPeakMax.toFixed(2)}g    Freinage : ${gMeterPeakMin.toFixed(2)}g`;
        }

        // Lissage court (3 derniers échantillons) pour stabiliser l'aiguille
        accelBuffer.push(g);
        if (accelBuffer.length > 3) accelBuffer.shift();
        const avg = accelBuffer.reduce((sum, v) => sum + v, 0) / accelBuffer.length;
        gMeterTarget = Math.min(G_METER_MAX, Math.max(G_METER_MIN, avg));
    }

    // Ligne de diagnostic : ce que le navigateur fournit réellement
    if (debugEl) {
        debugEl.textContent =
            `v = ${speedMs !== null && speedMs !== undefined ? speedMs.toFixed(1) : "--"} m/s (${speedSource})` +
            ` · Δt = ${dt !== null ? dt.toFixed(2) : "--"} s` +
            ` · a = ${acceleration !== null ? acceleration.toFixed(1) : "--"} m/s²` +
            ` · ${speedHistory.length} échantillons`;
    }

    animateGMeter();
}

function animateGMeter() {
    if (!gMeterCtx) return;

    const diff = gMeterTarget - gMeterDisplay;
    if (Math.abs(diff) < 0.005) {
        gMeterDisplay = gMeterTarget;
        drawGMeter();
        return;
    }
    if (gMeterAnimScheduled) return;
    gMeterAnimScheduled = true;

    // setTimeout plutôt que requestAnimationFrame : les navigateurs embarqués
    // throttlent parfois fortement les animations quand la page n'est pas active
    setTimeout(() => {
        gMeterAnimScheduled = false;
        const d = gMeterTarget - gMeterDisplay;
        gMeterDisplay += d * 0.3;
        drawGMeter();
        animateGMeter();
    }, 50);
}

function drawGMeter() {
    const ctx = gMeterCtx;
    if (!ctx) return;

    const W = 300, H = 300;
    const cx = 150, cy = 160, R = 120;

    // Angle (radians) : -1.5g à gauche (180°), 0g en haut (270°), +1.5g à droite (360°)
    const gToAngle = (g) => Math.PI + ((g + 1.5) / 3) * Math.PI;

    ctx.clearRect(0, 0, W, H);

    // Zones colorées
    const zones = [
        { min: -1.5, max: -1.0, color: "#e74c3c" },
        { min: -1.0, max: -0.4, color: "#f1c40f" },
        { min: -0.4, max: 0.4, color: "#2ecc71" },
        { min: 0.4, max: 1.0, color: "#f1c40f" },
        { min: 1.0, max: 1.5, color: "#e74c3c" }
    ];
    zones.forEach((z) => {
        ctx.beginPath();
        ctx.strokeStyle = z.color;
        ctx.lineWidth = 16;
        ctx.arc(cx, cy, R, gToAngle(z.min), gToAngle(z.max));
        ctx.stroke();
    });

    // Graduations tous les 0.5g
    ctx.font = "12px 'Segoe UI', Tahoma, sans-serif";
    ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let g = -1.5; g <= 1.5001; g += 0.5) {
        const a = gToAngle(g);

        ctx.beginPath();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
        ctx.lineWidth = 2;
        ctx.moveTo(cx + Math.cos(a) * (R - 20), cy + Math.sin(a) * (R - 20));
        ctx.lineTo(cx + Math.cos(a) * (R - 12), cy + Math.sin(a) * (R - 12));
        ctx.stroke();

        const label = g === 0 ? "0" : (g > 0 ? "+" + g.toFixed(1) : g.toFixed(1));
        ctx.fillText(label, cx + Math.cos(a) * (R - 38), cy + Math.sin(a) * (R - 38));
    }

    // Repères freinage / accélération
    ctx.font = "11px 'Segoe UI', Tahoma, sans-serif";
    ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
    ctx.fillText("◀ Freinage", cx - 85, cy + 48);
    ctx.fillText("Accél. ▶", cx + 85, cy + 48);

    // Aiguille
    const a = gToAngle(gMeterDisplay);
    ctx.beginPath();
    ctx.strokeStyle = "#ff2d2d";
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
    ctx.strokeStyle = "#ff2d2d";
    ctx.lineWidth = 2;
    ctx.stroke();
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
                if (page.id === "gauges" && !gMeterCtx) {
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
    const selector = document.getElementById("dataPointsSelector");
    if (!selector) return;

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
