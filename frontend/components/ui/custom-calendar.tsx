'use client'

import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react'
import { cn } from '@/lib/utils'

interface CustomCalendarProps {
  value?: string
  onChange: (date: string | null) => void
  placeholder?: string
  datesWithData?: string[] // Array of date strings (YYYY-MM-DD) that have call logs
}

export function CustomCalendar({ value, onChange, placeholder = 'Choose a date', datesWithData = [] }: CustomCalendarProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [popoverWidth, setPopoverWidth] = useState<number | undefined>(undefined)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [currentMonth, setCurrentMonth] = useState(() => {
    if (value) {
      const date = new Date(value)
      return new Date(date.getFullYear(), date.getMonth(), 1)
    }
    return new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  })

  useEffect(() => {
    if (triggerRef.current) {
      setPopoverWidth(triggerRef.current.offsetWidth)
    }
  }, [isOpen])

  const selectedDate = value ? new Date(value) : null
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ]

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear()
    const month = date.getMonth()
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)
    const daysInMonth = lastDay.getDate()
    const startingDayOfWeek = firstDay.getDay()

    const days: Array<{ date: Date; isCurrentMonth: boolean; isToday: boolean; isSelected: boolean }> = []

    // Previous month days
    const prevMonth = new Date(year, month - 1, 0)
    const prevMonthDays = prevMonth.getDate()
    for (let i = startingDayOfWeek - 1; i >= 0; i--) {
      const date = new Date(year, month - 1, prevMonthDays - i)
      days.push({
        date,
        isCurrentMonth: false,
        isToday: false,
        isSelected: false,
      })
    }

    // Current month days
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day)
      const dateStr = date.toISOString().split('T')[0]
      days.push({
        date,
        isCurrentMonth: true,
        isToday: dateStr === today.toISOString().split('T')[0],
        isSelected: !!(selectedDate && dateStr === selectedDate.toISOString().split('T')[0]),
      })
    }

    // Next month days to fill the grid
    const remainingDays = 42 - days.length // 6 rows * 7 days
    for (let day = 1; day <= remainingDays; day++) {
      const date = new Date(year, month + 1, day)
      days.push({
        date,
        isCurrentMonth: false,
        isToday: false,
        isSelected: false,
      })
    }

    return days
  }

  const hasCallLog = (date: Date) => {
    const dateStr = date.toISOString().split('T')[0]
    return datesWithData.includes(dateStr)
  }

  const handleDateSelect = (date: Date) => {
    const dateStr = date.toISOString().split('T')[0]
    onChange(dateStr)
    setIsOpen(false)
  }

  const handleToday = () => {
    const todayStr = today.toISOString().split('T')[0]
    onChange(todayStr)
    setIsOpen(false)
  }

  const handleClear = () => {
    onChange(null)
    setIsOpen(false)
  }

  const navigateMonth = (direction: 'prev' | 'next') => {
    setCurrentMonth((prev) => {
      const newDate = new Date(prev)
      if (direction === 'prev') {
        newDate.setMonth(prev.getMonth() - 1)
      } else {
        newDate.setMonth(prev.getMonth() + 1)
      }
      return newDate
    })
  }

  const days = getDaysInMonth(currentMonth)
  const currentMonthName = monthNames[currentMonth.getMonth()]
  const currentYear = currentMonth.getFullYear()

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          className="relative w-full h-9 px-3 pr-10 text-left text-sm rounded-md border border-gray-300 bg-white text-gray-700 hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        >
          <span className={cn(value ? 'text-gray-700' : 'text-gray-400')}>
            {value ? new Date(value).toLocaleDateString() : placeholder}
          </span>
          <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
        </button>
      </PopoverTrigger>
      <PopoverContent 
        className="p-0" 
        align="start"
        style={{ width: popoverWidth ? `${popoverWidth}px` : undefined }}
      >
        <div className="p-3">
          {/* Header */}
          <div className="flex items-center justify-between mb-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => navigateMonth('prev')}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <div className="text-center">
              <div className="font-semibold text-xs">{currentMonthName} {currentYear}</div>
              <div className="text-[10px] text-gray-500">Indian Standard Time (IST)</div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => navigateMonth('next')}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>

          {/* Day names */}
          <div className="grid grid-cols-7 gap-0.5 mb-1.5">
            {dayNames.map((day) => (
              <div key={day} className="text-center text-[10px] font-medium text-gray-600 py-0.5">
                {day}
              </div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7 gap-0.5">
            {days.map((day, index) => {
              const dateStr = day.date.toISOString().split('T')[0]
              const hasCall = hasCallLog(day.date)
              const isPast = day.date < today && !day.isToday

              return (
                <button
                  key={index}
                  type="button"
                  onClick={() => handleDateSelect(day.date)}
                  disabled={!day.isCurrentMonth}
                  className={cn(
                    'relative h-7 w-7 rounded-md text-xs transition-colors',
                    'hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500',
                    !day.isCurrentMonth && 'text-gray-300 cursor-not-allowed',
                    day.isCurrentMonth && !day.isSelected && !day.isToday && 'text-gray-700',
                    day.isToday && !day.isSelected && 'font-semibold text-blue-600',
                    day.isSelected && 'bg-blue-100 text-blue-900 font-semibold',
                    isPast && day.isCurrentMonth && 'opacity-60'
                  )}
                >
                  {day.date.getDate()}
                  {day.isCurrentMonth && (
                    <span
                      className={cn(
                        'absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full',
                        day.isSelected 
                          ? 'bg-blue-600' 
                          : hasCall 
                            ? 'bg-green-500' 
                            : 'bg-red-500'
                      )}
                    />
                  )}
                </button>
              )
            })}
          </div>

          {/* Footer buttons */}
          <div className="flex items-center justify-between mt-2.5 pt-2.5 border-t">
            <Button
              variant="outline"
              size="sm"
              onClick={handleToday}
              className="text-[10px] h-7 px-2"
            >
              Today (IST)
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleClear}
              className="text-[10px] h-7 px-2"
            >
              Clear
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

