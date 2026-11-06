import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('windows_scope',Path(__file__).resolve().parents[1]/'native'/'windows_scope.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class ScopeTests(unittest.TestCase):
    def scope(self,region=None):
        scope=module.WindowsScope.__new__(module.WindowsScope)
        scope.scope={'kind':'window','id':'11','pid':3,**({'region':region} if region else {})}
        scope.pid=lambda handle:3 if handle==11 else 4
        scope.rect=lambda handle,client=True:(100,200,800,600) if handle==11 else (0,0,2000,1400)
        scope.callback=lambda f:f
        class User:
            foreground=11
            top=11
            def GetWindowLongW(self,*args):return 0
            def EnumWindows(self,visit,_):
                for handle in [self.top,11]:
                    if not visit(handle,0):break
            def GetForegroundWindow(self):return self.foreground
            def GetAncestor(self,handle,_):return handle
        scope.u=User();return scope
    def test_crop_offsets_and_bounds(self):
        scope=self.scope({'x':50,'y':60,'width':320,'height':200})
        self.assertEqual(scope.bounds(),(150,260,320,200))
        self.assertTrue(scope.hit(150,260));self.assertTrue(scope.hit(469,459))
        for point in [(149,260),(470,260),(150,259),(150,460)]:self.assertFalse(scope.hit(*point))
        scope.u.top=22;self.assertFalse(scope.hit(200,300),'Covered pixels must never click the covering app')
    def test_resize_outside_area_fails_closed(self):
        scope=self.scope({'x':700,'y':0,'width':200,'height':200})
        self.assertIsNone(scope.bounds());self.assertFalse(scope.hit(810,220))
    def test_cropped_window_resize_requires_new_approval(self):
        scope=self.scope({'x':50,'y':60,'width':320,'height':200});scope.region_size=(800,600)
        self.assertIsNotNone(scope.bounds())
        scope.rect=lambda *args:(100,200,900,700)
        self.assertIsNone(scope.bounds());self.assertFalse(scope.key_allowed('KeyA',set()))
    def test_keyboard_focus_and_desktop_switch_shortcuts(self):
        scope=self.scope();self.assertTrue(scope.key_allowed('KeyA',set()))
        scope.u.foreground=22;self.assertFalse(scope.key_allowed('KeyA',set()))
        scope.u.foreground=11
        for code,keys in [('MetaLeft',set()),('Tab',{'AltLeft'}),('Escape',{'ControlLeft'}),('Delete',{'ControlLeft','AltLeft'})]:self.assertFalse(scope.key_allowed(code,keys))
        self.assertTrue(scope.key_allowed('KeyC',{'ControlLeft'}))

if __name__=='__main__':unittest.main()
