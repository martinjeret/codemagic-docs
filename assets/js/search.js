window.pageSearch = (function search(window) {
  return {
    init: function(indexUrl) {
      $.getJSON(indexUrl)
        .then(getSearchIndex)
        .then(initSearchEvents)
    }
  }

  function initSearchEvents(index) {
    $('.search__icon--search').on('click', function() {
      $(this)
        .closest('.search')
        .find('.search__input')
        .trigger('focus')
    })
    $('.search__icon--clear').on('mousedown', function() {
      // mousedown is before blur, 'click' wouldn't work because after blur the icon disappears
      updateFromInput(index, null)
    })

    $('.search__input')
      .bind('focus focusin', function() {
        $('.search').addClass('search--active')
      })
      .bind('blur focusout', function(event) {
        if (!event.target.value) {
          $('.search').removeClass('search--active')
        }
      })
      .on('keyup', function(event) {
        if (event.keyCode === 27) {
          // ESC
          updateFromInput(index, null)
          // prevent reaching to the second hanlder
          event.stopImmediatePropagation()
        }
      })
      .on(
        'keyup',
        debounce(function(event) {
          updateFromInput(index, event.target.value)
        }, 250)
      )

    updateFromUrl(index)

    window.addEventListener('popstate', function() {
      updateFromUrl(index)
    })
  }

  function updateFromInput(index, query) {
    updateUrl(query)
    updateInputs(query)
    window.setTimeout(function() {
      updateResults(index, query)
    })
  }

  function updateFromUrl(index) {
    var query =
      decodeURIComponent((window.location.search || '').slice(3)) || null
    updateInputs(query)
    window.setTimeout(function() {
      updateResults(index, query)
    })
  }

  function updateUrl(query) {
    window.history.pushState(
      '',
      document.title,
      window.location
        .toString()
        .substring(0, window.location.toString().indexOf('?')) +
        (query ? '?q=' + encodeURIComponent(query) : '')
    )
  }

  function updateResults(index, query) {
    var result
    try {
      if (query) {
        result = getResults(index, query)
      } else {
        result = null
      }
    } catch (error) {
      result = error
    }

    $('#search-results').html(getResultHtml(result, query, index))
  }

  function updateInputs(query) {
    var $inputs = $('.search__input')

    $inputs.val(query)
    if (query === null) {
      $inputs.trigger('blur')
    } else {
      if (query) {
        $('.search').addClass('search--active')
      }
    }
  }

  function getSearchIndex(pages) {
    return new Fuse(pages, {
      shouldSort: true,
      tokenize: true,
      matchAllTokens: true,
      findAllMatches: true,
      includeMatches: true,
      threshold: 0.1,
      location: 0,
      distance: 10000,
      maxPatternLength: 32,
      minMatchCharLength: 5,
      keys: [
        "title",
        "content"
      ]
    })
  }

  function getResultHtml(resultList, query, index) {
    if (!resultList) {
      return null
    }

    if (resultList instanceof Error) {
      return $('<div>', {
        class: 'no-results-message',
        text: 'Invalid search query: ' + resultList.message
      })
    }

    if (!resultList.length) {
      return $('<div>', {
        class: 'no-results-message',
        text: 'No results matching "' + query + '"'
      })
    }

    function orderByStartPosition(a, b) {
      return a.start - b.start
    }

    function collectSnippetPositions(contentLength, all, p) {
      var charsBefore = 30
      var charsAfter = 30
      var maxSnippetLength = 200

      var start = Math.max(p.start - charsBefore, 0)
      var end = Math.min(p.start + p.length + charsAfter, contentLength)

      var prev = all[all.length - 1]
      var isOverlappingWithPrevious = prev && prev.start + prev.length > start
      if (isOverlappingWithPrevious) {
        var newLength = end - prev.start
        if (newLength > maxSnippetLength) {
          return all
        }
        prev.length = newLength
        prev.keywords.push({ start: p.start - prev.start, length: p.length })
      } else {
        all.push({
          start: start,
          length: end - start,
          keywords: [{ start: p.start - start, length: p.length }]
        })
      }

      return all
    }

    function getSnippet(content, s) {
      var c = content.substr(s.start, s.length + 1)
      var m = c.match(index.options.tokenSeparator)

      var isStartOfContent = s.start === 0
      var firstKw = s.keywords[0]
      var start = isStartOfContent
        ? 0
        : Math.min(firstKw.start, m ? c.indexOf(m[0]) + m[0].length : 0)
      var lastKw = s.keywords[s.keywords.length - 1]

      var isEndOfContent = s.start + s.length === content.length
      var end = isEndOfContent
        ? c.length + 1
        : Math.max(
            lastKw.start + lastKw.length,
            m ? c.lastIndexOf(m[m.length - 1]) : c.length + 1
          )

      c = c.substring(start, end)

      return Object.assign({}, s, {
        content: c,
        isStart: isStartOfContent,
        isEnd: isEndOfContent,
        keywords: s.keywords.map(function(k) {
          return { start: k.start - start, length: k.length }
        })
      })
    }

    function getContentSnippets(contentPositions, content) {
      var content = (content || '').trim()
      if (contentPositions.length) {
        return contentPositions
          .sort(orderByStartPosition)
          .reduce(collectSnippetPositions.bind(null, content.length), [])
          .map(getSnippet.bind(null, content))
          .slice(0, 3)
      } else {
        return [
          {
            isStart: true,
            isEnd: false,
            content: content.substring(0, 100),
            keywords: contentPositions
          }
        ]
      }
    }

    return $('<ul>', {
      html: resultList.map(function(result) {
        var snippets = getContentSnippets(
          result.positions.content,
          result.content
        )

        return $('<li>', {
          html: [
            $('<a>', {
              html: markText(result.title, result.positions.title),
              href: result.uri
            }),
            snippets
              ? $('<p>', {
                  html: snippets.map(function(s) {
                    return $('<span>', {
                      class: [
                        s.isStart ? 'start' : '',
                        s.isEnd ? 'end' : ''
                      ].join(' '),
                      html: markText(s.content, s.keywords)
                    })
                  })
                })
              : null
          ]
        })
      })
    })
  }

  function markText(text, positions) {
    var prefix = '<mark>'
    var suffix = '</mark>'
    var increment = prefix.length + suffix.length

    return positions.reduce(function(text, position, index) {
      var offset = index * increment + position.start
      return (
        text.slice(0, offset) +
        prefix +
        text.slice(offset, offset + position.length) +
        suffix +
        text.slice(offset + position.length)
      )
    }, text)
  }

  function getResults(index, query) {
    return index
      .search(query)
      .slice(0, 16)
      .map(function(result) {
        var positions = { title: [], content: [] }
        $.each(result.matches, function(_, match) {
          positions[match.key] = match.indices.map(function(i) {
            return { start: i[0], end: i[1] + 1, length: i[1] - i[0] + 1 }
          })
        })
        return Object.assign({}, result.item, { positions: positions })
      })
  }

  function debounce(func, wait, immediate) {
    var timeout

    return function() {
      var context = this
      var args = arguments

      var callNow = immediate && !timeout

      clearTimeout(timeout)

      timeout = setTimeout(function() {
        timeout = null

        if (!immediate) {
          func.apply(context, args)
        }
      }, wait)

      if (callNow) func.apply(context, args)
    }
  }
})(window)

// TODO: longest substrings and then longest consecutive substrings