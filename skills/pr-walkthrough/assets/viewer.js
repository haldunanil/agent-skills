/* PR Walkthrough viewer — renders the embedded walkthrough JSON into Layout A.
   highlight.js (window.hljs) and markdown-it (window.markdownit) are optional CDN
   progressive enhancements; the page renders fully without them. */
(function () {
  'use strict'

  var dataEl = document.getElementById('walkthrough-data')
  var data
  try { data = JSON.parse(dataEl.textContent) } catch (e) { data = null }

  var md = window.markdownit ? window.markdownit({ html: false, linkify: true, breaks: false }) : null
  var app = document.getElementById('app')

  var EXT_LANG = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript',
    py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', swift: 'swift',
    c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp', php: 'php',
    sh: 'bash', bash: 'bash', zsh: 'bash', json: 'json', yml: 'yaml', yaml: 'yaml',
    md: 'markdown', sql: 'sql', css: 'css', scss: 'scss', html: 'xml', xml: 'xml',
  }
  function langOf(file) {
    var ext = (file.split('.').pop() || '').toLowerCase()
    return EXT_LANG[ext] || ''
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag)
    if (cls) e.className = cls
    if (text != null) e.textContent = text
    return e
  }

  function prose(srcMarkdown) {
    var div = el('div', 'prose')
    if (!srcMarkdown) return div
    if (md) div.innerHTML = md.render(srcMarkdown)         // html:false → input HTML is escaped
    else { var pre = el('pre', 'md-fallback'); pre.textContent = srcMarkdown; div.appendChild(pre) }
    return div
  }

  function diffStats(diffText) {
    var add = 0, del = 0, lines = (diffText || '').split('\n')
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i]
      if (l.charAt(0) === '+' && l.slice(0, 3) !== '+++') add++
      else if (l.charAt(0) === '-' && l.slice(0, 3) !== '---') del++
    }
    return { add: add, del: del }
  }

  function parseHunkHeader(line) {
    var m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    return m ? { oldStart: +m[1], newStart: +m[2] } : null
  }

  // side is 'left' or 'right' (which gutter); cls drives the color (del/add/ctx/empty).
  function codeCell(side, no, text, cls, lang) {
    var num = el('td', (side === 'right' ? 'rno ' : 'lno ') + cls, no === '' ? '' : String(no))
    var td = el('td', (side === 'right' ? 'rc ' : 'lc ') + cls)
    if (cls !== 'empty') {
      var c = el('code', null, text)
      if (lang) c.setAttribute('data-lang', lang)
      td.appendChild(c)
    }
    return [num, td]
  }

  function appendRow(table, left, right) {
    var tr = el('tr')
    tr.appendChild(left[0]); tr.appendChild(left[1]); tr.appendChild(right[0]); tr.appendChild(right[1])
    table.appendChild(tr)
  }

  function buildDiff(diffText, lang) {
    var table = el('table', 'diff')
    var lines = diffText.split('\n')
    var i = 0
    while (i < lines.length && lines[i].slice(0, 2) !== '@@') i++
    while (i < lines.length) {
      var hh = parseHunkHeader(lines[i])
      if (!hh) { i++; continue }
      var sep = el('tr', 'hunksep'); var sepTd = el('td', null, lines[i]); sepTd.colSpan = 4
      sep.appendChild(sepTd); table.appendChild(sep)
      var oldNo = hh.oldStart, newNo = hh.newStart
      i++
      var dels = [], adds = []
      function flush() {
        var n = Math.max(dels.length, adds.length)
        for (var k = 0; k < n; k++) {
          var d = dels[k], a = adds[k]
          var left = d ? codeCell('left', d.no, d.text, 'del', lang) : codeCell('left', '', '', 'empty', lang)
          var right = a ? codeCell('right', a.no, a.text, 'add', lang) : codeCell('right', '', '', 'empty', lang)
          appendRow(table, left, right)
        }
        dels = []; adds = []
      }
      for (; i < lines.length && lines[i].slice(0, 2) !== '@@'; i++) {
        var ln = lines[i]
        if (ln.charAt(0) === '\\') continue            // "\ No newline at end of file"
        var tag = ln.charAt(0), text = ln.slice(1)
        if (tag === '-') dels.push({ no: oldNo++, text: text })
        else if (tag === '+') adds.push({ no: newNo++, text: text })
        else {
          flush()
          appendRow(table, codeCell('left', oldNo, text, 'ctx', lang), codeCell('right', newNo, text, 'ctx', lang))
          oldNo++; newNo++
        }
      }
      flush()
    }
    return table
  }

  function contextBlock(c) {
    var box = el('div', 'context')
    box.appendChild(el('div', 'label', 'Context (unchanged): ' + c.ref + ' [' + c.lines.join('–') + ']'))
    box.appendChild(prose(c.note))
    var pre = el('pre', 'context-code'), code = el('code', null, c.resolvedCode || '')
    var lang = langOf(c.ref); if (lang) code.setAttribute('data-lang', lang)
    pre.appendChild(code); box.appendChild(pre)
    return box
  }

  function sectionEl(s, id) {
    var sec = el('section', 'file'); sec.id = id
    var head = el('div', 'file-head')
    head.appendChild(el('span', 'caret', '▾'))
    head.appendChild(el('span', 'path', s.file + (s.unit ? ' — ' + s.unit : '')))
    if (s.kind !== 'normal') head.appendChild(el('span', 'badge', s.kind))
    if (s.kind === 'normal' && s.resolvedDiff) {
      var st = diffStats(s.resolvedDiff), counts = el('span', 'counts')
      counts.innerHTML = '<span class="add">+' + st.add + '</span> <span class="del">−' + st.del + '</span>'
      head.appendChild(counts)
    }
    head.addEventListener('click', function () { sec.classList.toggle('collapsed') })
    sec.appendChild(head)

    var body = el('div', 'file-body')
    body.appendChild(prose(s.narrative))
    ;(s.contexts || []).forEach(function (c) { body.appendChild(contextBlock(c)) })
    if (s.kind === 'normal' && s.resolvedDiff) {
      body.appendChild(buildDiff(s.resolvedDiff, langOf(s.file)))
    } else if (s.kind !== 'normal') {
      var txt = s.note || ''
      if (s.kind === 'generated' && s.derivedFrom) txt += '\n\n_generated from `' + s.derivedFrom + '`_'
      body.appendChild(prose(txt))
    }
    sec.appendChild(body)
    return sec
  }

  function sidebarFileLink(s, id) {
    var a = el('a', 'file-link'); a.href = '#' + id; a.setAttribute('data-target', id)
    a.appendChild(el('span', 'name', (s.unit ? s.unit + ' ' : '') + s.file))
    if (s.kind === 'normal' && s.resolvedDiff) {
      var st = diffStats(s.resolvedDiff), c = el('span', 'counts')
      c.innerHTML = '<span class="add">+' + st.add + '</span> <span class="del">−' + st.del + '</span>'
      a.appendChild(c)
    } else { a.appendChild(el('span', 'counts', s.kind)) }
    return a
  }

  function topbar() {
    var bar = el('div', 'topbar')
    bar.appendChild(el('h1', null, 'PR #' + data.pr.number + ': ' + data.pr.title))
    var meta = el('div', 'meta')
    meta.innerHTML =
      data.pr.repo + ' #' + data.pr.number + ' &middot; @' + data.pr.author +
      ' &middot; <code>' + data.pr.headBranch + '→' + data.pr.baseBranch + '</code>' +
      ' &middot; ' + data.pr.filesCount + ' files, ' + data.pr.commitsCount + ' commits' +
      ' &middot; <a href="' + data.pr.url + '">' + data.pr.url + '</a>'
    bar.appendChild(meta)
    bar.appendChild(prose(data.summary))
    var controls = el('div', 'controls')
    var btn = el('button', null, 'Collapse all')
    var collapsed = false
    btn.addEventListener('click', function () {
      collapsed = !collapsed
      document.querySelectorAll('.file').forEach(function (f) { f.classList.toggle('collapsed', collapsed) })
      btn.textContent = collapsed ? 'Expand all' : 'Collapse all'
    })
    controls.appendChild(btn); bar.appendChild(controls)
    return bar
  }

  function tailSection(title, id, markdown) {
    var s = el('section', 'tail'); s.id = id
    s.appendChild(el('h2', null, title))
    s.appendChild(prose(markdown))
    return s
  }

  function commitTail() {
    var s = el('section', 'tail'); s.id = 'commit-map'
    s.appendChild(el('h2', null, 'Commit map'))
    var t = el('table', 'commits')
    var head = el('tr'); ['SHA', 'Message', 'Chapters'].forEach(function (h) { head.appendChild(el('th', null, h)) })
    t.appendChild(head)
    ;(data.commitMap || []).forEach(function (c) {
      var tr = el('tr')
      tr.appendChild(el('td', 'sha', c.sha))
      tr.appendChild(el('td', null, c.message))
      tr.appendChild(el('td', null, (c.chapters || []).join(', ')))
      t.appendChild(tr)
    })
    s.appendChild(t); return s
  }

  function highlightSection(sec) {
    if (!window.hljs || sec.getAttribute('data-hl')) return
    sec.setAttribute('data-hl', '1')
    sec.querySelectorAll('code[data-lang]').forEach(function (c) {
      var lang = c.getAttribute('data-lang')
      try {
        var res = lang && window.hljs.getLanguage(lang)
          ? window.hljs.highlight(c.textContent, { language: lang })
          : window.hljs.highlightAuto(c.textContent)
        c.innerHTML = res.value
      } catch (e) { /* leave as plain text */ }
    })
  }

  function render() {
    app.textContent = ''
    if (!data) { app.appendChild(el('div', 'empty-state', 'Could not parse walkthrough data.')); return }

    app.appendChild(topbar())

    var hasContent = (data.chapters || []).some(function (c) { return (c.sections || []).length })
    if (!hasContent) {
      app.appendChild(el('div', 'empty-state', 'This PR has no file changes to walk through.'))
      return
    }

    var layout = el('div', 'layout')
    var sidebar = el('nav', 'sidebar')
    var main = el('div', 'main')

    data.chapters.forEach(function (ch, ci) {
      var navChap = el('div', 'chap')
      var chTitle = el('a', 'chap-title'); chTitle.href = '#chap-' + ci; chTitle.textContent = ch.title
      navChap.appendChild(chTitle)

      var chapter = el('section', 'chapter'); chapter.id = 'chap-' + ci
      chapter.appendChild(el('h2', null, ch.title))
      chapter.appendChild(prose(ch.intro))

      ch.sections.forEach(function (s, si) {
        var id = 'sec-' + ci + '-' + si
        navChap.appendChild(sidebarFileLink(s, id))
        chapter.appendChild(sectionEl(s, id))
      })

      sidebar.appendChild(navChap)
      main.appendChild(chapter)
    })

    ;['Cross-cutting concerns:cross-cutting', 'Open questions:open-questions', 'Commit map:commit-map']
      .forEach(function (pair) {
        var label = pair.split(':')[0], id = pair.split(':')[1]
        var link = el('a', 'tail-link', label); link.href = '#' + id; sidebar.appendChild(link)
      })

    main.appendChild(tailSection('Cross-cutting concerns', 'cross-cutting', data.crossCutting))
    main.appendChild(tailSection('Open questions', 'open-questions', data.openQuestions))
    main.appendChild(commitTail())

    layout.appendChild(sidebar); layout.appendChild(main)
    app.appendChild(layout)

    // lazy syntax highlighting when a section scrolls near the viewport
    var hlObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { highlightSection(en.target); hlObs.unobserve(en.target) } })
    }, { rootMargin: '400px 0px' })
    main.querySelectorAll('.file').forEach(function (f) { hlObs.observe(f) })

    // active sidebar link tracking
    var links = sidebar.querySelectorAll('.file-link')
    var byId = {}; links.forEach(function (a) { byId[a.getAttribute('data-target')] = a })
    var actObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return
        links.forEach(function (a) { a.classList.remove('active') })
        var a = byId[en.target.id]; if (a) a.classList.add('active')
      })
    }, { rootMargin: '-10% 0px -80% 0px' })
    main.querySelectorAll('.file').forEach(function (f) { actObs.observe(f) })
  }

  render()
})()
