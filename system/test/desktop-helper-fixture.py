"""Run the real desktop protocol/watchdog with a recording OS adapter."""
import importlib.util
import json
from pathlib import Path

spec=importlib.util.spec_from_file_location('desktop_input',Path(__file__).resolve().parent.parent/'native'/'desktop-input.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
def log(event,**value):print(json.dumps({'observed':event,**value}),flush=True)
class Recorder:
    width=1920;height=1080
    def key(self,code,down,keys):log('key',code=code,down=down)
    def button(self,button,down):log('button',button=button,down=down)
    def move(self,x,y):log('move',x=x,y=y)
    def wheel(self,dx,dy):log('wheel',dx=dx,dy=dy)
    def refresh(self):self.width=1280;self.height=1024
module.main(Recorder())
