import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Onboarding from './pages/Onboarding'
import Graph from './pages/Graph'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Onboarding />} />
        <Route path="/graph" element={<Graph />} />
      </Routes>
    </BrowserRouter>
  )
}
