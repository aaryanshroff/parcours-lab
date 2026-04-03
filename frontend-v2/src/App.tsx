import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Toaster } from 'sonner'
import Onboarding from './pages/Onboarding'
import Graph from './pages/Graph'
import Summary from './pages/Summary'

export default function App() {
  return (
    <BrowserRouter>
      <Toaster richColors position="bottom-center" />
      <Routes>
        <Route path="/" element={<Onboarding />} />
        <Route path="/graph" element={<Graph />} />
        <Route path="/summary" element={<Summary />} />
      </Routes>
    </BrowserRouter>
  )
}
