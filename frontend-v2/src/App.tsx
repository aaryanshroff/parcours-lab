import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Toaster } from 'sonner'
import Onboarding from './pages/Onboarding'
import Graph from './pages/Graph'

export default function App() {
  return (
    <BrowserRouter>
      <Toaster richColors position="bottom-center" />
      <Routes>
        <Route path="/" element={<Onboarding />} />
        <Route path="/graph" element={<Graph />} />
      </Routes>
    </BrowserRouter>
  )
}
