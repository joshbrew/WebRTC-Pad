"""Exercise Windows scope math without loading any Windows input API."""
import ctypes.wintypes
import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('desktop',Path(__file__).resolve().parent.parent/'native'/'desktop-input.py')
desktop=importlib.util.module_from_spec(spec);spec.loader.exec_module(desktop)
class Scope:
    allowed=True
    covered=False
    def bounds(self):return (100,100,200,100)
    def pointer_allowed(self):return self.allowed
    def key_allowed(self):return self.allowed
    def hit(self,x,y):return not self.covered and 100<=x<300 and 100<=y<200
class User:
    def GetCursorPos(self,point):point._obj.x=150;point._obj.y=150
class Tests(unittest.TestCase):
    def test_relative_movement_cannot_escape_selected_window_or_pass_occlusion_focus_checks(self):
        api=object.__new__(desktop.Windows);api.user=User();api.scope=Scope();writes=[];api.mouse=lambda flags,**values:writes.append((flags,values))
        api.relative(500,500);self.assertEqual(writes[-1],(1,{'x':149,'y':49}))
        api.relative(-500,-500);self.assertEqual(writes[-1],(1,{'x':-50,'y':-50}))
        count=len(writes);api.scope.covered=True;api.relative(10,10);self.assertEqual(len(writes),count)
        api.scope.covered=False;api.scope.allowed=False;api.relative(10,10);self.assertEqual(len(writes),count)
if __name__=='__main__':unittest.main()
