let currentPosition = null;
let lastSpeedMs = null;
let lastPositionTime = null;
let speedHistory = [];
let accelerationHistory = [];
let timeHistory = [];
let speedChart = null;
let accelerationChart = null;
let gMeterGauge = null;
let currentMaxDataPoints = 60;

const MAX_HISTORY = 120; // Garde jusqu'à 120 points d'historique
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

function updateSpeed() {
    if ("geolocation" in navigator) {
        navigator.geolocation.watchPosition(
            (position) => {
                const speed = position.coords.speed;
                const timestamp = position.timestamp;

                if (speed !== null) {
                    const speedKmh = Math.round(speed * 3.6);
                    const speedEl = document.getElementById("speed");
                    if (speedEl) speedEl.textContent = speedKmh;

                    // Accélération réelle : variation de vitesse / durée écoulée (m/s²)
                    let acceleration = null;
                    if (lastSpeedMs !== null) {
                        const dt = (timestamp - lastPositionTime) / 1000;
                        if (dt > 0.1 && dt < 5) {
                            acceleration = (speed - lastSpeedMs) / dt;
                        }
                    }
                    lastSpeedMs = speed;
                    lastPositionTime = timestamp;

                    // Mise à jour de l'historique
                    const now = new Date();
                    const timeLabel = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

                    speedHistory.push(speedKmh);
                    accelerationHistory.push(acceleration !== null ? Math.round(acceleration * 10) / 10 : null);
                    timeHistory.push(timeLabel);

                    // Limiter l'historique complet
                    if (speedHistory.length > MAX_HISTORY) {
                        speedHistory.shift();
                        accelerationHistory.shift();
                        timeHistory.shift();
                    }

                    // Mise à jour des graphiques et du G-mètre
                    updateCharts();
                    updateGMeter(acceleration);
                } else {
                    // Perte de vitesse GPS : réinitialisation pour éviter les faux pics
                    lastSpeedMs = null;
                    lastPositionTime = null;
                }

                currentPosition = position.coords;
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
    } else {
        const speedEl = document.getElementById("speed");
        if (speedEl) speedEl.textContent = "N/A";
    }
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
        acceleration: accelerationHistory.slice(startIndex)
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
    accelerationChart.update('none');
}

// --- G-Mètre ---

function initGMeter() {
    const canvas = document.getElementById("gMeterGauge");
    if (!canvas || typeof Gauge === "undefined") return;

    gMeterGauge = new Gauge(canvas);
    gMeterGauge.setOptions({
        angle: -0.25,
        lineWidth: 0.08,
        radiusScale: 0.95,
        pointer: {
            length: 0.55,
            strokeWidth: 0.04,
            color: "#ff2d2d"
        },
        limitMax: false,
        limitMin: false,
        strokeColor: "#2a2a2a",
        generateGradient: true,
        highDpiSupport: true,
        staticZones: [
            { strokeStyle: "#e74c3c", min: -1.5, max: -1.0 },
            { strokeStyle: "#f1c40f", min: -1.0, max: -0.4 },
            { strokeStyle: "#2ecc71", min: -0.4, max: 0.4 },
            { strokeStyle: "#f1c40f", min: 0.4, max: 1.0 },
            { strokeStyle: "#e74c3c", min: 1.0, max: 1.5 }
        ]
    });
    gMeterGauge.setMinValue(G_METER_MIN);
    gMeterGauge.setMaxValue(G_METER_MAX);
    gMeterGauge.animationSpeed = 12;
    gMeterGauge.set(0);
}

function updateGMeter(acceleration) {
    if (acceleration === null) return;

    const g = acceleration / GRAVITY;
    const valueEl = document.getElementById("gMeterValue");
    if (valueEl) {
        valueEl.textContent = `${g >= 0 ? "+" : ""}${g.toFixed(2)}g`;
    }

    if (gMeterGauge) {
        // On borne l'affichage à la plage du cadran
        const clamped = Math.min(G_METER_MAX, Math.max(G_METER_MIN, g));
        gMeterGauge.set(clamped);
    }
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
                if (page.id === "gauges" && !gMeterGauge) {
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
