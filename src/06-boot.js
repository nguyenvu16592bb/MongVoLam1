
/* ============================== KHỞI ĐỘNG ============================== */
window.MVL = {
  Game, State, Battle, Info, Engine, World, UI, Sfx, SaveManager,
  CharacterManager, PlayerController, ARENAS, HERO_DEFS, SKILLS, SHOP_ITEMS
};

window.addEventListener('error', function (e) {
  const t = document.getElementById('load-tip');
  if (t && !Game.booted && e && e.message) t.textContent = 'Lỗi khởi tạo: ' + e.message;
});

Game.boot();
