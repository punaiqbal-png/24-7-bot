require('dotenv').config();
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals: { GoalNear, GoalBlock } } = require('mineflayer-pathfinder');
const autoeat = require('mineflayer-auto-eat');
const Vec3 = require('vec3');

const HOST = process.env.MC_HOST || 'play.example.com';
const PORT = parseInt(process.env.MC_PORT || '25565', 10);
const USER = process.env.MC_USER || 'MyBot';
const PASS = process.env.MC_PASS || '';
const VERSION = process.env.MC_VERSION || false;
const OWNER = (process.env.MC_OWNER || '').toLowerCase();
const AFK_INTERVAL = parseInt(process.env.AFK_INTERVAL || '60', 10);

let reconnectTimeout = 5000;

function createBot() {
  const bot = mineflayer.createBot({ host: HOST, port: PORT, username: USER, password: PASS || undefined, version: VERSION || false });

  bot.loadPlugin(pathfinder);
  bot.loadPlugin(autoeat);

  bot.once('spawn', () => {
    const defaultMove = new Movements(bot, require('minecraft-data')(bot.version));
    bot.pathfinder.setMovements(defaultMove);
    console.log('✅ Bot spawned.');
  });

  bot.on('autoeat_started', () => console.log('🍗 Auto-eat started'));
  bot.on('autoeat_stopped', () => console.log('🍽️ Auto-eat stopped'));

  bot.on('error', err => console.log('❌ Bot error:', err.message || err));
  bot.on('end', reason => {
    console.log('⚠️ Bot disconnected. Reason:', reason);
    setTimeout(() => { console.log('🔁 Reconnecting...'); createBot(); }, reconnectTimeout);
  });

  // Anti-AFK
  let afkIntervalRef;
  bot.once('spawn', () => {
    if (AFK_INTERVAL > 0) {
      afkIntervalRef = setInterval(() => {
        const pos = bot.entity.position;
        const dx = (Math.random() - 0.5) * 0.1;
        const dz = (Math.random() - 0.5) * 0.1;
        bot.setControlState('jump', true);
        setTimeout(() => bot.setControlState('jump', false), 250);
        bot.look(bot.entity.yaw + dx, bot.entity.pitch + dz, true);
      }, AFK_INTERVAL * 1000);
    }
  });
  bot.on('leave', () => { if (afkIntervalRef) clearInterval(afkIntervalRef); });

  // Chat & Command system
  const activeFollowers = new Map();
  let shopInventory = {}; // Simple Shop Bot storage

  bot.on('chat', (username, message) => {
    if (!message) return;
    console.log(`<${username}> ${message}`);
    handleChatCommand(bot, username, message.toLowerCase());
  });

  async function handleChatCommand(bot, username, message) {
    const lcUser = username.toLowerCase();
    if (!message.startsWith('!')) return;
    const args = message.slice(1).trim().split(/ +/g);
    const cmd = args.shift();

    // Public commands
    if (cmd === 'ping') { bot.chat('pong'); return; }
    if (cmd === 'pos') { const p = bot.entity.position; bot.chat(`pos: ${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)}`); return; }
    if (cmd === 'help') { bot.chat('Commands: !help, !ping, !pos. Owner: !follow <player>, !stop, !goto x y z, !say msg, !eat, !equip <item>, !shop'); return; }

    // Owner-only
    if (OWNER && lcUser !== OWNER) return;

    // Follow player
    if (cmd === 'follow') {
      const target = args[0];
      if (!target) return bot.chat('Usage: !follow <player>');
      const player = bot.players[target];
      if (!player || !player.entity) return bot.chat(`I can't see ${target}`);
      bot.chat(`Following ${target}`);
      bot.pathfinder.setGoal(new GoalNear(player.entity.position.x, player.entity.position.y, player.entity.position.z, 1), true);
      activeFollowers.set('current', target);
      return;
    }

    // Stop
    if (cmd === 'stop') { bot.chat('Stopping movement.'); bot.pathfinder.setGoal(null); activeFollowers.delete('current'); return; }

    // Goto
    if (cmd === 'goto') {
      if (args.length < 3) return bot.chat('Usage: !goto <x> <y> <z>');
      const [x,y,z] = args.map(Number);
      if (args.some(v => isNaN(v))) return bot.chat('Invalid coordinates.');
      bot.chat(`Going to ${x} ${y} ${z}`);
      bot.pathfinder.setGoal(new GoalBlock(x, y, z));
      return;
    }

    // Say
    if (cmd === 'say') { const text = args.join(' '); if (!text) return bot.chat('Usage: !say <msg>'); bot.chat(text); return; }

    // Eat
    if (cmd === 'eat') { try { await bot.autoEat.eat(); bot.chat('Tried to eat'); } catch(err){ bot.chat('Could not eat'); } return; }

    // Equip
    if (cmd === 'equip') { const itemName = args.join(' '); if (!itemName) return bot.chat('Usage: !equip <item>'); const item = bot.inventory.items().find(i => i.name.includes(itemName)); if (!item) return bot.chat('I do not have that item'); await bot.equip(item,'hand'); bot.chat(`Equipped ${item.name}`); return; }

    // Simple Shop Bot
    if (cmd === 'shop') {
      const action = args[0];
      const item = args[1];
      const amount = parseInt(args[2] || '1');
      if (!action || !item) return bot.chat('Usage: !shop <buy/sell> <item> <amount>');
      shopInventory[item] = shopInventory[item] || 0;
      if (action === 'buy') { shopInventory[item] += amount; bot.chat(`Bought ${amount} ${item}. Total: ${shopInventory[item]}`); }
      else if (action === 'sell') { shopInventory[item] = Math.max(shopInventory[item]-amount,0); bot.chat(`Sold ${amount} ${item}. Remaining: ${shopInventory[item]}`); }
      else bot.chat('Unknown action. Use buy or sell');
      return;
    }
  }

  // Auto-follow update loop
  setInterval(() => {
    const targetName = activeFollowers.get('current');
    if (!targetName) return;
    const player = bot.players[targetName];
    if (player && player.entity) {
      const pos = player.entity.position;
      const g = new GoalNear(pos.x, pos.y, pos.z, 1);
      bot.pathfinder.setGoal(g, true);
    }
  }, 2000);

  return bot;
}

createBot();
