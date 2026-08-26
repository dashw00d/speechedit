const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')

const url = process.argv[2] || 'http://127.0.0.1:5173/'
const output = process.argv[3] || '/tmp/speechedit-browser.png'
const width = Number(process.argv[4] || 1440)
const height = Number(process.argv[5] || 1000)
const action = process.argv[6] || ''

app.whenReady().then(async () => {
  const errors = []
  const window = new BrowserWindow({
    show: false,
    width,
    height,
    webPreferences: { sandbox: true, backgroundThrottling: false },
  })

  window.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2) errors.push(message)
  })

  await window.loadURL(url)
  await new Promise((resolve) => setTimeout(resolve, 450))

  if (action) {
    await window.webContents.executeJavaScript(`(async () => {
      const clickText = (text) => {
        const el = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === text)
        if (!el) throw new Error('Missing button: ' + text)
        el.click()
      }
      const tick = () => new Promise((resolve) => setTimeout(resolve, 30))
      const action = ${JSON.stringify(action)}
      if (action === 'empty') {
        clickText('File')
        clickText('New reel')
      } else if (action === 'file-menu') {
        clickText('File')
      } else if (action === 'mobile-script') {
        document.querySelector('.mobile-workspace-nav button:nth-child(3)')?.click()
      } else if (action === 'mobile-timeline') {
        document.querySelector('.mobile-workspace-nav button:nth-child(4)')?.click()
      } else if (action === 'preferences') {
        clickText('File')
        clickText('Preferences…')
      } else if (action === 'party') {
        clickText('File')
        clickText('Preferences…')
        await tick()
        const party = [...document.querySelectorAll('[role="radio"]')].find((node) => node.textContent.includes('Party'))
        if (!party) throw new Error('Missing Party theme')
        party.click()
        clickText('Done')
      } else if (action === 'palette') {
        clickText('Edit')
        clickText('Command palette')
      } else if (action === 'review') {
        clickText('Review issues')
      } else if (action === 'review-next') {
        clickText('Review issues')
        await tick()
        clickText('Keep')
      } else if (action === 'next-issue') {
        clickText('Review next issue')
      } else if (action === 'next-issue-pause') {
        clickText('Review next issue')
        await tick()
        const pause = document.querySelector('button.play')
        if (!pause) throw new Error('Missing pause button')
        pause.click()
      } else if (action === 'next-issue-decide') {
        clickText('Review next issue')
        await tick()
        clickText('Silent demo')
      } else if (action === 'select-word') {
        const word = document.querySelector('button.word')
        if (!word) throw new Error('Missing transcript word')
        word.click()
      } else if (action === 'assistant-with-selection') {
        const word = document.querySelector('button.word')
        if (!word) throw new Error('Missing transcript word')
        word.click()
        await tick()
        clickText('Assistant')
      } else if (action === 'project-with-selection') {
        const word = document.querySelector('button.word')
        if (!word) throw new Error('Missing transcript word')
        word.click()
        await tick()
        clickText('Project')
      } else if (action === 'mobile-assistant-with-selection') {
        const word = document.querySelector('button.word')
        if (!word) throw new Error('Missing transcript word')
        word.click()
        clickText('Review')
        await tick()
        clickText('Assistant')
      } else if (action === 'playback-menu') {
        clickText('1×')
      } else if (action === 'play-brief') {
        const play = document.querySelector('button.play')
        if (!play) throw new Error('Missing play button')
        play.click()
        await new Promise((resolve) => setTimeout(resolve, 1500))
      } else if (action === 'range-menu') {
        clickText('Mark clip')
      } else if (action === 'add-track-menu') {
        clickText('+ Add track')
      } else if (action === 'track-menu') {
        const more = document.querySelector('.track-label .track-flag[aria-haspopup="menu"]')
        if (!more) throw new Error('Missing track menu')
        more.click()
      } else if (action === 'transcript-options') {
        clickText('•••')
      } else if (action === 'word-more') {
        const word = document.querySelector('button.word')
        if (!word) throw new Error('Missing transcript word')
        word.click()
        await tick()
        const more = document.querySelector('.word-popover .overflow-menu > button')
        if (!more) throw new Error('Missing word actions menu')
        more.click()
      } else if (action === 'transcript-takes') {
        const script = document.querySelector('.script')
        if (!script) throw new Error('Missing transcript document')
        const takes = document.querySelector('[data-take-first="true"]')
        if (!takes) throw new Error('Missing take group')
        script.scrollTop = Math.max(0, takes.offsetTop - 180)
      } else if (action === 'protect-outside') {
        clickText('Protect')
        await tick()
        const timeline = document.querySelector('.timeline-body')
        const outside = document.querySelector('.monitor')
        if (!timeline || !outside) throw new Error('Missing timeline or outside panel')
        const before = timeline.getAttribute('data-tool')
        outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
        await tick()
        window.__browserAudit = {
          before,
          after: timeline.getAttribute('data-tool')
        }
      } else if (action === 'agent-followup' || action === 'agent-activity' || action === 'agent-mini-scenes') {
        localStorage.setItem('speechedit:settings', JSON.stringify({
          transcript: { kind: 'whisper-cpp', baseUrl: '', model: 'base.en', apiKey: '' },
          intelligence: {
            kind: 'openai-compatible',
            baseUrl: 'http://127.0.0.1:11434/v1',
            model: 'nemotron-3-ultra:cloud',
            apiKey: ''
          }
        }))
        if (document.querySelector('.mobile-workspace-nav')) {
          clickText('Review')
          await tick()
        }
        clickText('Assistant')
        await tick()
        const beforeScenes = document.querySelectorAll('.scene-chip[data-scene-id]').length
        const input = document.querySelector('.agent-panel textarea')
        if (!input) throw new Error('Missing Agent input')
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
        setter.call(input, action === 'agent-mini-scenes'
          ? 'split my caption into mini scenes'
          : 'What is the strongest opening in this reel? Do not edit.')
        input.dispatchEvent(new Event('input', { bubbles: true }))
        await tick()
        clickText('Send request')
        const deadline = Date.now() + 180000
        while (!document.querySelector('.agent-turn-list button') && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 500))
        }
        const finished = document.querySelector('.agent-turn-list button')
        if (!finished) throw new Error('Agent call did not finish in time')
        let selectedPriorContext = ''
        if (action === 'agent-followup') {
          finished.click()
          await tick()
          selectedPriorContext = document.querySelector('.agent-followup strong')?.textContent || ''
          const followInput = document.querySelector('.agent-panel textarea')
          setter.call(followInput, 'Why? Be concise and do not edit.')
          followInput.dispatchEvent(new Event('input', { bubbles: true }))
          await tick()
          clickText('Ask follow-up')
          while (document.querySelectorAll('.agent-turn-list button').length < 2 && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 500))
          }
        }
        const context = document.querySelector('.agent-followup strong')?.textContent || ''
        window.__browserAudit = {
          activityInsideInspector: Boolean(document.querySelector('.inspector .agent-activity-feed')),
          floatingActivityVisible: Boolean(document.querySelector('.model-activity, .agent-dock')),
          finishedCalls: document.querySelectorAll('.agent-turn-list button').length,
          followUpContext: context,
          selectedPriorContext,
          assistantInsideInspector: Boolean(document.querySelector('.inspector .agent-panel')),
          outcome: document.querySelector('.agent-turn-outcome')?.textContent.trim() || '',
          toolActions: [...document.querySelectorAll('.agent-calls code')].map((node) => node.textContent.trim()),
          toolResults: [...document.querySelectorAll('.agent-calls li')].map((node) => node.textContent.trim()),
          beforeScenes,
          afterScenes: document.querySelectorAll('.scene-chip[data-scene-id]').length
        }
      }
    })()`)
    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  const report = await window.webContents.executeJavaScript(`(() => {
    const all = [...document.querySelectorAll('*')]
    const clipped = all.filter((el) => {
      const style = getComputedStyle(el)
      return (el.scrollWidth > el.clientWidth + 1 && style.overflowX !== 'visible') ||
        (el.scrollHeight > el.clientHeight + 1 && style.overflowY !== 'visible')
    }).slice(0, 30).map((el) => ({
      tag: el.tagName.toLowerCase(),
      className: el.className,
      text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 100),
      client: [el.clientWidth, el.clientHeight],
      scroll: [el.scrollWidth, el.scrollHeight],
    }))
    const controls = [...document.querySelectorAll('button, input, select, textarea, [role="button"]')]
    const isLabeled = (el) => Boolean(
      (el.textContent || '').trim() ||
      el.getAttribute('aria-label') ||
      el.getAttribute('aria-labelledby') ||
      el.getAttribute('title') ||
      el.getAttribute('placeholder') ||
      el.closest('label')?.textContent.trim()
    )
    return {
      title: document.title,
      theme: document.documentElement.dataset.theme,
      viewport: [innerWidth, innerHeight],
      document: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
      controls: controls.length,
      unlabeledControls: controls.filter((el) => !isLabeled(el)).length,
      unlabeled: controls.filter((el) => !isLabeled(el)).map((el) => el.outerHTML.slice(0, 400)),
      clipped,
      text: (document.body.innerText || '').slice(0, 5000),
      audit: window.__browserAudit || null,
    }
  })()`)

  const image = await window.webContents.capturePage()
  fs.writeFileSync(output, image.toPNG())
  process.stdout.write(JSON.stringify({ ...report, errors, output }, null, 2))
  window.destroy()
  app.exit(0)
})
