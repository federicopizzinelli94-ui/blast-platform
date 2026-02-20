// clear_skeletons.js
localStorage.setItem('incoming_leads_count', '0');
window.dispatchEvent(new Event("storage"));
console.log("Skeletons cleared.");
