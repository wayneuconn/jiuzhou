import { Outlet } from 'react-router-dom'
import BottomTabBar from './BottomTabBar'

export default function AppLayout() {
  return (
    <div className="min-h-[100svh] bg-pitch flex flex-col">
      <main className="flex-1 max-w-lg mx-auto w-full px-4 pt-6 pb-28 overflow-y-auto">
        <Outlet />
      </main>
      <BottomTabBar />
    </div>
  )
}
