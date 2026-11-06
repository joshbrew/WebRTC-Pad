// Isolate the native binding and its notification threads from the web server.
const { createInterface } = require('node:readline');
const { createNativeInjector } = require('../src/inject/windows-vigem.js');
const { normalizeState, neutralState } = require('../src/inject/state.js');
let driver, timer;
const playerCount = Number(process.argv[2] || 4);
const controllerType = process.argv[3] || 'auto';
const slots = new Set(Array.from({ length: playerCount }, (_, i) => `p${i + 1}`));
const updated = new Map();
const vibrations = new Map();
function close(code = 0) {
  clearInterval(timer);
  if (driver) {
    for (const slot of slots) { try { driver.setState(slot, neutralState()); } catch {} }
    driver.close();
  }
  // vigemclient keeps native notification handles alive after disconnect.
  // Exiting this helper also releases its ViGEm client handle in the OS.
  process.exit(code);
}
try {
  driver = createNativeInjector({ playerCount, controllerType, onFeedback:value=>{vibrations.set(value.slot,{...value,at:Date.now()});if(process.stdout.writableLength<8192)console.log(JSON.stringify(value));} });
  for (const slot of slots) driver.setState(slot, neutralState());
  console.log('READY');
  const lines = createInterface({ input: process.stdin });
  lines.on('line', line => {
    try {
      const msg = JSON.parse(line);
      if(msg.type==='add' || msg.type==='remove') {
        try {
          let value;
          if(msg.type==='add'){value=driver.addController(msg.slot);slots.add(msg.slot);}
          else {driver.removeController(msg.slot);slots.delete(msg.slot);updated.delete(msg.slot);vibrations.delete(msg.slot);}
          console.log(JSON.stringify({id:msg.id,value}));
        }catch(error){console.log(JSON.stringify({id:msg.id,error:error.message}));}
        return;
      }
      if (!slots.has(msg.slot)) return;
      driver.setState(msg.slot, normalizeState(msg.state)); updated.set(msg.slot, Date.now());
    } catch (error) { console.error(error.message); close(1); }
  });
  lines.on('close', () => close());
  timer = setInterval(() => {
    for(const [slot,value] of vibrations)if(slots.has(slot) && updated.has(slot) && (value.large || value.small) && Date.now()-value.at>=100){value.at=Date.now();if(process.stdout.writableLength<8192)console.log(JSON.stringify(value));}
    for (const [slot, time] of updated) if (Date.now() - time > 500) {
      try { driver.setState(slot, neutralState()); updated.delete(slot); }
      catch (error) { console.error(error.message); close(1); }
    }
  }, 100);
  for (const event of ['SIGINT', 'SIGTERM']) process.once(event, () => close());
} catch (error) { console.error(error.message); close(1); }
