import { useState } from 'react'
import LobbyScreen from './components/LobbyScreen'
import WaitingScreen from './components/WaitingScreen'
import ChatScreen from './components/ChatScreen'

function getSenderToken() {
  return crypto.randomUUID()
}

export default function App() {
  const [screen, setScreen] = useState('lobby')
  const [room, setRoom] = useState(null)
  const [myToken] = useState(getSenderToken)

  function goWaiting(room) {
    setRoom(room)
    setScreen('waiting')
  }

  function goChat(room) {
    setRoom(room)
    setScreen('chat')
  }

  function goLobby() {
    setRoom(null)
    setScreen('lobby')
  }

  return (
    <div style={{ height: '100%' }}>
      {screen === 'lobby' && (
        <LobbyScreen onCreated={goWaiting} onJoined={goChat} />
      )}
      {screen === 'waiting' && (
        <WaitingScreen
          room={room}
          onPartnerJoined={() => setScreen('chat')}
          onCancel={goLobby}
        />
      )}
      {screen === 'chat' && (
        <ChatScreen room={room} myToken={myToken} onEnd={goLobby} />
      )}
    </div>
  )
}
