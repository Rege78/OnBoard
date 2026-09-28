let currentPosition = null;
let lastSpeed = 0;
let speedHistory = [];
let accelerationHistory = [];
let timeHistory = [];
let speedChart = null;

const MAX_HISTORY = 60; // Garde 60 points d'historique

function updateSpeed() {
    if ("geolocation" in navigator) {
        navigator.geolocation.watchPosition(
            (position) => {
                const speed = position.coords.speed;
                if (speed !== null) {
                    const speedKmh = Math.round(speed * 3.6);
                    const speedEl = document.getElementById("speed");
                    if (speedEl) speedEl.textContent = speedKmh;

                    // Calcul de l'accélération (variation de vitesse en m/s²)
                    const acceleration = speed - lastSpeed;
                    lastSpeed = speed;

                    // Mise à jour de l'historique
                    const now = new Date();
                    const timeLabel = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

                    speedHistory.push(speedKmh);
                    accelerationHistory.push(Math.round(acceleration * 100) / 100);
                    timeHistory.push(timeLabel);

                    // Limiter l'historique
                    if (speedHistory.length > MAX_HISTORY) {
                        speedHistory.shift();
                        accelerationHistory.shift();
                        timeHistory.shift();
                    }

                    // Mise à jour du graphique
                    updateChart();
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

function initChart() {
    const ctx = document.getElementById("speedChart");
    if (!ctx) return;

    speedChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: timeHistory,
            datasets: [
                {
                    label: '💨 Vitesse (km/h)',
                    data: speedHistory,
                    borderColor: 'rgb(255, 45, 45)',
                    backgroundColor: 'rgba(255, 45, 45, 0.1)',
                    borderWidth: 2,
                    tension: 0.3,
                    fill: true,
                    yAxisID: 'y'
                },
                {
                    label: '⚡ Accélération (m/s²)',
                    data: accelerationHistory,
                    borderColor: 'rgb(255, 204, 0)',
                    backgroundColor: 'rgba(255, 204, 0, 0.1)',
                    borderWidth: 2,
                    tension: 0.3,
                    fill: true,
                    yAxisID: 'y1'
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
                },
                y1: {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    title: {
                        display: true,
                        text: 'Accélération (m/s²)',
                        color: 'rgb(255, 204, 0)'
                    },
                    grid: {
                        drawOnChartArea: false
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

function updateChart() {
    if (!speedChart) return;
    
    speedChart.data.labels = timeHistory;
    speedChart.data.datasets[0].data = speedHistory;
    speedChart.data.datasets[1].data = accelerationHistory;
    speedChart.update('none');
}

function initSidebar() {
    const menuBtn = document.getElementById("menuBtn");
    const sidebar = document.getElementById("sidebar");
    const pagesList = document.getElementById("pagesList");
    const pageTitle = document.getElementById("pageTitle");

    const pages = [
        { id: "speed", label: "💨 Vitesse", title: "Vitesse" },
        { id: "details", label: "📍 Détails GPS", title: "Détails GPS" },
        { id: "graph", label: "📈 Graphiques", title: "Graphiques" }
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
                
                // Initialiser le graphique la première fois qu'on accède à la page
                if (page.id === "graph" && !speedChart) {
                    setTimeout(initChart, 100);
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

function updateTime() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const timeEl = document.getElementById("time");
    if (timeEl) timeEl.textContent = `${hours}:${minutes}`;
}

window.addEventListener("load", () => {
    updateSpeed();
    updateTime();
    initSidebar();
    setInterval(updateTime, 60000);
});