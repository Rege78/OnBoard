// Fonction pour récupérer la vitesse via le GPS
function updateSpeed() {
    if ("geolocation" in navigator) {
        navigator.geolocation.watchPosition(
            (position) => {
                const speed = position.coords.speed; // Vitesse en m/s
                if (speed !== null) {
                    // Convertir en km/h (1 m/s = 3.6 km/h)
                    const speedKmh = Math.round(speed * 3.6);
                    document.getElementById("speed").textContent = speedKmh;
                }
            },
            (error) => {
                console.error("Erreur de géolocalisation : ", error);
                document.getElementById("speed").textContent = "N/A";
            },
            {
                enableHighAccuracy: true,
                maximumAge: 0,
                timeout: 5000
            }
        );
    } else {
        document.getElementById("speed").textContent = "N/A";
    }
}

// Démarrer la mise à jour de la vitesse
window.onload = updateSpeed;
