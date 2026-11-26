"""Browser end-to-end flow (Playwright for Python). Needs API on :4000 and `vite preview` on :4173 (see docs/STATUS.md)."""
import re, time, json, datetime
from playwright.sync_api import sync_playwright, expect

BASE='http://localhost:4173'
CODE=''

def calm(p):
    """Silence the start-alarm screen if it is up (it is meant to take over the screen)."""
    p.wait_for_timeout(700)
    b=p.get_by_role('button', name='Silence')
    if b.count() and b.first.is_visible(): b.first.click(); p.wait_for_timeout(300)
errors=[]
def run():
    with sync_playwright() as pw:
        b=pw.chromium.launch()
        ctx=b.new_context(viewport={'width':1280,'height':820}, device_scale_factor=1, timezone_id='Africa/Nairobi', permissions=[])
        p=ctx.new_page()
        p.on('console', lambda m: errors.append(f'console.{m.type}: {m.text}') if m.type=='error' else None)
        p.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
        p.goto(BASE+'/')
        # intro shows on first visit
        expect(p.get_by_role('dialog', name='Welcome')).to_be_visible()
        p.wait_for_timeout(1800); p.screenshot(path='/home/claude/scratch/shots/01-intro.png')
        p.get_by_role('dialog', name='Welcome to CYMOR TO-DO').click()
        p.evaluate("localStorage.setItem('cymor.nointro','1')")
        expect(p.get_by_text('call you?')).to_be_visible(timeout=5000)
        p.screenshot(path='/home/claude/scratch/shots/02-welcome.png')
        # username-only start (no email, no password)
        p.get_by_label('Your username').fill('Legendary Smiley')
        p.get_by_role('button', name='Begin').click()
        expect(p.get_by_text('Your recovery code')).to_be_visible(timeout=8000)
        global CODE
        CODE=p.get_by_label('Recovery code').inner_text().strip()
        print('recovery code shown:', CODE)
        p.screenshot(path='/home/claude/scratch/shots/02b-recovery.png')
        expect(p.get_by_role('button', name='Enter CYMOR')).to_be_disabled()
        p.get_by_text('I stored this code').click()
        p.get_by_role('button', name='Enter CYMOR').click()
        expect(p.get_by_text('Good ', exact=False).first).to_be_visible(timeout=10000)
        print('guest start + dashboard OK, url', p.url)
        # create an activity starting 1 min ago, ending in 59 min (so it is "now") via planner UI
        now=datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=3)))
        s=(now-datetime.timedelta(minutes=1)).strftime('%H:%M'); e=(now+datetime.timedelta(minutes=59)).strftime('%H:%M')
        p.get_by_role('link', name='New activity').first.click()
        p.get_by_role('textbox', name='Activity').fill('Study Mathematics')
        p.locator('input[type=time]').nth(0).fill(s); p.locator('input[type=time]').nth(1).fill(e)
        p.screenshot(path='/home/claude/scratch/shots/03-form.png')
        p.get_by_role('button', name='Add activity').click()
        expect(p.get_by_text('Study Mathematics').first).to_be_visible(timeout=8000)
        # overlapping second activity -> overlap warning, nothing moved
        calm(p); p.get_by_role('link', name='New activity').first.click()
        p.get_by_role('textbox', name='Activity').fill('Overlapper')
        p.locator('input[type=time]').nth(0).fill(s); p.locator('input[type=time]').nth(1).fill(e)
        p.get_by_role('button', name='Add activity').click()
        expect(p.get_by_text('overlap').first).to_be_visible(timeout=8000)
        p.screenshot(path='/home/claude/scratch/shots/04-planner.png')
        # the start ALARM screen takes over because Study Mathematics has begun and nobody checked in
        calm(p); p.reload()
        expect(p.get_by_role('alertdialog')).to_be_visible(timeout=8000)
        p.screenshot(path='/home/claude/scratch/shots/04b-alarm.png')
        print('alarm overlay shown OK')
        p.get_by_role('button', name='I am starting now').click()
        calm(p)
        p.get_by_role('link', name='Today').first.click()
        expect(p.get_by_role('button', name='Check out')).to_be_visible(timeout=8000)
        p.wait_for_timeout(2500)
        p.screenshot(path='/home/claude/scratch/shots/05-dashboard-running.png')
        p.get_by_role('button', name='Pause').click()
        expect(p.get_by_role('button', name='Resume')).to_be_visible(timeout=8000)
        p.get_by_role('button', name='Resume').click()
        expect(p.get_by_role('button', name='Pause')).to_be_visible(timeout=8000)
        # FULLY OFFLINE: everything keeps working; reload the app with no network; create an activity; then reconnect and back up
        ctx.set_offline(True)
        p.evaluate("window.dispatchEvent(new Event('offline'))")
        expect(p.get_by_text('Offline mode')).to_be_visible(timeout=5000)
        p.get_by_role('button', name='Pause').click()
        expect(p.get_by_role('button', name='Resume')).to_be_visible(timeout=5000)
        p.reload(); p.wait_for_timeout(1500); calm(p)
        expect(p.get_by_role('button', name='Resume')).to_be_visible(timeout=10000)
        print('app reloaded with NO internet and still shows the running activity')
        calm(p); p.get_by_role('link', name='New activity').first.click()
        p.get_by_role('textbox', name='Activity').fill('Written offline')
        p.locator('input[type=time]').nth(0).fill('22:00'); p.locator('input[type=time]').nth(1).fill('22:30')
        p.get_by_role('button', name='Add activity').click()
        expect(p.get_by_text('Written offline').first).to_be_visible(timeout=8000)
        p.screenshot(path='/home/claude/scratch/shots/06-offline.png')
        ops=p.evaluate("""() => new Promise(r => { const q = indexedDB.open('cymor-local'); q.onsuccess = () => { const g = q.result.transaction('kv').objectStore('kv').get('ops'); g.onsuccess = () => r(g.result) } })""")
        print('changes queued on the phone while offline:', [o['method']+' '+o['path'] for o in ops])
        ctx.set_offline(False)
        p.evaluate("window.dispatchEvent(new Event('online'))")
        expect(p.get_by_text('Backed up').first).to_be_visible(timeout=15000)
        print('offline changes backed up OK')
        tok=json.loads(p.evaluate("localStorage.getItem('cymor.tokens')"))
        import urllib.request
        d=datetime.date.today().isoformat()
        rq=urllib.request.Request(f'http://localhost:4000/api/activities?from={d}&to={d}', headers={'authorization':'Bearer '+tok['accessToken']})
        titles=[a['title'] for a in json.load(urllib.request.urlopen(rq))['activities']]
        assert 'Written offline' in titles, titles
        print('server has the activity created offline:', titles)
        # check out
        calm(p); p.get_by_role('link', name='Today').first.click()
        p.get_by_role('button', name='Resume').click()
        p.get_by_role('button', name='Check out').click()
        p.wait_for_timeout(1200)
        p.screenshot(path='/home/claude/scratch/shots/07-after-checkout.png')
        # reminders: create Drink Water template and see preview
        p.get_by_role('link', name='Reminders').first.click()
        p.get_by_role('button', name='+ New reminder').click()
        expect(p.get_by_text('Next firings')).to_be_visible()
        p.wait_for_timeout(900)
        p.screenshot(path='/home/claude/scratch/shots/08-reminder-form.png')
        p.get_by_role('button', name='Create reminder').click()
        expect(p.get_by_text('Drink Water').first).to_be_visible(timeout=8000)
        expect(p.get_by_text('Every 2h, 08:00–20:00')).to_be_visible()
        p.screenshot(path='/home/claude/scratch/shots/09-reminders.png')
        # analytics
        p.get_by_role('link', name='Analytics').first.click()
        expect(p.get_by_text('Completion')).to_be_visible(timeout=8000)
        p.screenshot(path='/home/claude/scratch/shots/10-analytics.png')
        # notifications centre
        p.get_by_role('link', name='Alerts').first.click()
        expect(p.get_by_text('System check')).to_be_visible(timeout=8000)
        
        p.screenshot(path='/home/claude/scratch/shots/11-notifications.png')
        # growth + settings
        p.get_by_role('link', name='Growth').first.click()
        p.get_by_placeholder('New habit, e.g. Read 20 pages').fill('Read'); p.get_by_role('button', name='Add').click()
        expect(p.get_by_text('Read', exact=True).first).to_be_visible(timeout=8000)
        p.get_by_role('link', name='Settings').first.click()
        expect(p.get_by_role('heading', name='Backup & recovery')).to_be_visible(timeout=8000)
        p.get_by_label('Theme').first if False else None
        p.screenshot(path='/home/claude/scratch/shots/12-settings.png', full_page=True)
        # service worker registered (prod build)
        p.wait_for_timeout(1000)
        sw=p.evaluate("navigator.serviceWorker.getRegistration().then(r => !!r && !!(r.active||r.installing||r.waiting))")
        print('service worker registered:', sw)
        # mobile view
        m=b.new_context(viewport={'width':390,'height':800}, device_scale_factor=2, timezone_id='Africa/Nairobi', is_mobile=True, has_touch=True)
        mp=m.new_page()
        mp.goto(BASE+'/restore'); mp.evaluate("localStorage.setItem('cymor.nointro','1')"); mp.reload()
        mp.get_by_label('Recovery code').fill(CODE); mp.get_by_role('button', name='Restore my account').click()
        expect(mp.get_by_text('Good ', exact=False).first).to_be_visible(timeout=10000)
        print('restore with recovery code OK')
        mp.wait_for_timeout(600); calm(mp); mp.screenshot(path='/home/claude/scratch/shots/13-mobile-dashboard.png')
        for nm,path in [('14-mobile-planner','/planner'),('15-mobile-alerts','/notifications'),('16-mobile-settings','/settings')]:
            mp.get_by_role('link', name=path[1:].capitalize() if path!='/notifications' else 'Alerts').first.click() if False else mp.goto(BASE+path)
            mp.wait_for_timeout(900); calm(mp); mp.screenshot(path=f'/home/claude/scratch/shots/{nm}.png', full_page=True)
            print('overflow',nm, mp.evaluate('document.documentElement.scrollWidth > document.documentElement.clientWidth'))
        ov=mp.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth")
        print('mobile horizontal overflow:', ov)
        b.close()
try:
    run(); print('E2E PASSED')
except Exception as ex:
    print('E2E FAILED:', str(ex)[:600])
print('browser errors:', errors[:8])
