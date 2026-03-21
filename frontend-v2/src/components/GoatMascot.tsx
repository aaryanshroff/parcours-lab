import goatImg from '../assets/mountain-goat.png'

interface GoatMascotProps {
  message?: string
}

export default function GoatMascot({ message }: GoatMascotProps) {
  return (
    <div className="fixed bottom-4 left-4 z-50">
      {message && (
        <div className="absolute -top-2 left-16 -translate-y-full max-w-48">
          <div className="rounded-lg bg-white px-3 py-2 text-sm text-gray-800 shadow-md">
            {message}
          </div>
          <div className="ml-2 h-0 w-0 border-x-6 border-t-6 border-x-transparent border-t-white" />
        </div>
      )}
      <img src={goatImg} alt="Goat mascot" className="h-20 w-20 object-contain" />
    </div>
  )
}
