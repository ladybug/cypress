import cs from 'classnames'
import { action, when, autorun, IReactionDisposer } from 'mobx'
import React, { useRef, useEffect, useState } from 'react'
import { default as $Cypress } from '@packages/driver'

import State from '../../src/lib/state'
import AutIframe from './aut-iframe'
import { ScriptError } from '../errors/script-error'
import SnapshotControls from './snapshot-controls'
import IframeModel from './iframe-model'
import selectorPlaygroundModel from '../selector-playground/selector-playground-model'
import styles from '../app/RunnerCt.module.scss'
import eventManager from '../lib/event-manager'
import { namedObserver } from '../lib/mobx'
import './iframes.scss'

export function getSpecUrl ({ namespace, spec }, prefix = '') {
  return spec ? `${prefix}/${namespace}/iframes/${spec.absolute}` : ''
}

interface IFramesProps {
  state: State
  eventManager: typeof eventManager
  config: Cypress.RuntimeConfigOptions
}

export const Iframes: React.FC<IFramesProps> = namedObserver('Iframes', (props) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [autIframe] = useState(new AutIframe(props.config))
  const [disposers, setDisposers] = useState<IReactionDisposer[]>([])

  const [iframeModel] = useState(
    new IframeModel({
      state: props.state,
      restoreDom: autIframe.restoreDom,
      highlightEl: autIframe.highlightEl,
      detachDom: autIframe.detachDom,
      snapshotControls: (snapshotProps) => (
        <SnapshotControls
          eventManager={props.eventManager}
          snapshotProps={snapshotProps}
          state={props.state}
          onToggleHighlights={_toggleSnapshotHighlights}
          onStateChange={_changeSnapshotState}
        />
      ),
    }),
  )

  useEffect(() => {
    props.eventManager.on('visit:failed', autIframe.showVisitFailure)
    props.eventManager.on('before:screenshot', autIframe.beforeScreenshot)
    props.eventManager.on('after:screenshot', autIframe.afterScreenshot)
    props.eventManager.on('script:error', _setScriptError)

    // TODO: need to take headless mode into account
    // may need to not display reporter if more than 200 tests
    props.eventManager.on('restart', () => {
      _run(props.state.spec, props.config)
    })

    props.eventManager.on('print:selector:elements:to:console', autIframe.printSelectorElementsToConsole)

    props.eventManager.start(props.config)

    setDisposers([
      autorun(() => {
        autIframe.toggleSelectorPlayground(selectorPlaygroundModel.isEnabled)
      }),
      autorun(() => {
        autIframe.toggleSelectorHighlight(selectorPlaygroundModel.isShowingHighlight)
      }),
      autorun(() => {
        if (props.state.spec) {
          _run(props.state.spec, props.config)
        }
      }),
    ])

    iframeModel.listen()

    return () => {
      props.eventManager.notifyRunningSpec(null)
      props.eventManager.stop()
      disposers.forEach((dispose) => {
        dispose()
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    props.state.callbackAfterUpdate?.()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.state.callbackAfterUpdate])

  const _toggleSnapshotHighlights = (snapshotProps) => {
    props.state.snapshot.showingHighlights = !props.state.snapshot.showingHighlights

    if (props.state.snapshot.showingHighlights) {
      const snapshot = snapshotProps.snapshots[props.state.snapshot.stateIndex]

      autIframe.highlightEl(snapshot, snapshotProps)
    } else {
      autIframe.removeHighlights()
    }
  }

  const _changeSnapshotState = (snapshotProps, index) => {
    const snapshot = snapshotProps.snapshots[index]

    props.state.snapshot.stateIndex = index
    autIframe.restoreDom(snapshot)

    if (props.state.snapshot.showingHighlights && snapshotProps.$el) {
      autIframe.highlightEl(snapshot, snapshotProps)
    } else {
      autIframe.removeHighlights()
    }
  }

  const _setScriptError = action((err: string | undefined) => {
    props.state.scriptError = err
  })

  const _run = (spec, config) => {
    config.spec = spec

    _setScriptError(undefined)

    props.eventManager.setup(config)

    // This is extremely required to not run test till devtools registered
    when(() => props.state.readyToRunTests, () => {
      window.Cypress.on('window:before:load', props.state.registerDevtools)

      const $autIframe = _loadIframes(spec)

      props.eventManager.initialize($autIframe, config)
    })
  }

  // jQuery is a better fit for managing these iframes, since they need to get
  // wiped out and reset on re-runs and the snapshots are from dom we don't control
  const _loadIframes = (spec: Cypress.Cypress['spec']) => {
    const specSrc = getSpecUrl({ namespace: props.config.namespace, spec })
    const $container = $Cypress.$(containerRef.current).empty()
    const $autIframe = autIframe.create().appendTo($container)

    autIframe.showBlankContents()

    // In mount mode we need to render something right from spec file
    // So load application tests to the aut frame
    $autIframe.prop('src', specSrc)

    return $autIframe
  }

  const { viewportHeight, viewportWidth, scriptError, scale, screenshotting } = props.state

  return (
    <div
      style={{
        display: props.state.screenshotting ? 'inherit' : 'grid',
      }}
      className={cs('iframes-ct-container', {
        'has-error': !!scriptError,
        'iframes-ct-container-screenshotting': screenshotting,
      })}
    >
      <div
        ref={containerRef}
        className={
          cs('size-container', {
            [styles.noSpecAut]: !props.state.spec,
          })
        }
        style={{
          height: viewportHeight,
          width: viewportWidth,
          transform: `scale(${screenshotting ? 1 : scale})`,
        }}
      />
      <ScriptError error={scriptError} />
      <div className='cover' />
    </div>
  )
})
