import { useState, useEffect, useRef } from 'react'
import { gamemaster } from './gamemaster-client'
import messagesData from './data/messages.json'
import './App.css'

interface Message {
  id: string
  content: string
  delay: number
  duration?: number
}

const DISPLAY_DURATION = 5000

const predefinedMessages: Message[] = messagesData as Message[]

function App() {
  const [currentMessage, setCurrentMessage] = useState<string>('')
  const [isTyping, setIsTyping] = useState(false)
  const [isFadingOut, setIsFadingOut] = useState(false)
  const [isVisible, setIsVisible] = useState(false)
  const [customInput, setCustomInput] = useState('')
  const messageQueueRef = useRef<Message[]>([])
  const isProcessingRef = useRef(false)

  const showMessage = (message: Message): Promise<void> => {
    return new Promise((resolve) => {
      setCurrentMessage('')
      setIsTyping(true)
      setIsFadingOut(false)
      setIsVisible(true)

      let charIndex = 0
      const content = message.content
      const typingSpeed = 50

      const typeChar = () => {
        if (charIndex < content.length) {
          setCurrentMessage(content.slice(0, charIndex + 1))
          charIndex++
          setTimeout(typeChar, typingSpeed)
        } else {
          setIsTyping(false)

          const displayTime = message.duration ?? DISPLAY_DURATION

          setTimeout(() => {
            setIsFadingOut(true)

            setTimeout(() => {
              setIsVisible(false)
              setIsFadingOut(false)
              setCurrentMessage('')
              setTimeout(resolve, 300)
            }, 800)
          }, displayTime)
        }
      }

      setTimeout(typeChar, 200)
    })
  }

  const processMessageQueue = async () => {
    if (isProcessingRef.current || messageQueueRef.current.length === 0) return

    isProcessingRef.current = true

    while (messageQueueRef.current.length > 0) {
      const message = messageQueueRef.current.shift()
      if (message) {
        await showMessage(message)
      }
    }

    isProcessingRef.current = false
  }

  const addMessageToQueue = (message: Message) => {
    messageQueueRef.current.push(message)
    processMessageQueue()
  }

  const sendPredefinedMessage = (messageId: string) => {
    const message = predefinedMessages.find(m => m.id === messageId)
    if (message) {
      addMessageToQueue(message)
    }
  }

  const sendCustomMessage = (content: string) => {
    const customMessage: Message = {
      id: `custom-${Date.now()}`,
      content,
      delay: 0
    }
    addMessageToQueue(customMessage)
  }

  useEffect(() => {
    gamemaster.register('messagerie', 'Messagerie', [
      { id: 'send_predefined', label: 'Envoyer prédéfini', params: ['messageId'] },
      { id: 'send_custom', label: 'Envoyer custom', params: ['content'] },
      { id: 'start_sequence', label: 'Séquence intro' },
      ...predefinedMessages.map(m => ({
        id: `msg_${m.id}`,
        label: m.content.slice(0, 40)
      }))
    ])

    gamemaster.onCommand(({ action, payload }) => {
      console.log('[Messagerie] Command received:', action, payload)

      if (action === 'send_predefined') {
        const messageId = payload.messageId as string
        sendPredefinedMessage(messageId)
      } else if (action === 'send_custom') {
        const content = payload.content as string
        sendCustomMessage(content)
      } else if (action === 'start_sequence') {
        predefinedMessages.forEach(m => addMessageToQueue(m))
      } else if (action.startsWith('msg_')) {
        const messageId = action.replace('msg_', '')
        sendPredefinedMessage(messageId)
      }
    })

    gamemaster.onConnect(() => {
      console.log('[Messagerie] Connected to backoffice')
    })

    gamemaster.onDisconnect(() => {
      console.log('[Messagerie] Disconnected from backoffice')
    })
  }, [])

  return (
    <div className="messagerie-container">
      <div className="scanline"></div>
      <div className="grid-overlay"></div>

      <main className="chat-container">
        {isVisible ? (
          <div className={`message ${isFadingOut ? 'fade-out' : 'fade-in'}`}>
            <div className="message-content">
              {currentMessage}
              {isTyping && <span className="typing-cursor">▌</span>}
            </div>
          </div>
        ) : (
          <div className="empty-state">
            <span className="blink-cursor">_</span>
          </div>
        )}
      </main>

      <footer className="messagerie-footer">
        <div className="test-controls">
          <div className="test-predefined">
            {predefinedMessages.map(m => (
              <button key={m.id} onClick={() => sendPredefinedMessage(m.id)}>
                {m.content.slice(0, 20)}
              </button>
            ))}
          </div>
          <form className="test-custom" onSubmit={(e) => {
            e.preventDefault()
            if (customInput.trim()) {
              sendCustomMessage(customInput.trim())
              setCustomInput('')
            }
          }}>
            <input
              type="text"
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              placeholder="Message custom..."
            />
            <button type="submit">Envoyer</button>
          </form>
        </div>
      </footer>
    </div>
  )
}

export default App
