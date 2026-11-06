// Test browsers must not register synthetic tabs with Windows Alt+Tab.
// This is confined to our automation processes, never the user's browser.
export function testBrowserOptions(options={}){
  const disabled=new Set(['msWindowTabManagerPublic']),args=[];
  for(const argument of options.args || []){
    if(argument.startsWith('--disable-features=')){
      for(const feature of argument.slice('--disable-features='.length).split(','))if(feature)disabled.add(feature);
    }
    else args.push(argument);
  }
  return {...options,args:[...args,`--disable-features=${[...disabled].join(',')}`]};
}

export async function launchTestBrowser(browserType,options){
  const browser=await browserType.launch(browserType.name?.()==='firefox'?options:testBrowserOptions(options));
  const close=browser.close.bind(browser);let closing;
  browser.close=(...args)=>closing ||= (async()=>{
    // Remove tabs/context registrations before terminating the browser process.
    // A stuck context must not prevent the owned browser from being closed.
    let timer;
    try{
      await Promise.race([
        Promise.all(browser.contexts().map(context=>Promise.resolve().then(()=>context.close()).catch(()=>{}))),
        new Promise(resolve=>{timer=setTimeout(resolve,4000);timer.unref?.();})
      ]);
    }finally{clearTimeout(timer);await close(...args);}
  })();
  return browser;
}
