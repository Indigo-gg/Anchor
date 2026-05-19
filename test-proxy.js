const { reactive, toRaw } = require('vue');

// Simulation of role object
const role = reactive({
    id: "role_1",
    toolKeys: ["skill_web_search", "skill_music"]
});

// Update logic
const idx = role.toolKeys.indexOf("skill_music");
if (idx !== -1) {
    role.toolKeys.splice(idx, 1);
}

// Save logic
console.log(JSON.stringify(toRaw(role)));

// Check if nested is plain
console.log(toRaw(role).toolKeys);
