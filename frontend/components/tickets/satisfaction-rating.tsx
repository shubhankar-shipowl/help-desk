'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/use-toast'
import { Star } from 'lucide-react'

interface SatisfactionRatingProps {
  ticketId: string
  existingRating?: {
    rating: number
    feedback: string | null
  }
  onRatingSubmitted?: () => void
}

export function SatisfactionRating({
  ticketId,
  existingRating,
  onRatingSubmitted,
}: SatisfactionRatingProps) {
  const { toast } = useToast()
  const [rating, setRating] = useState(existingRating?.rating || 0)
  const [hoveredRating, setHoveredRating] = useState(0)
  const [feedback, setFeedback] = useState(existingRating?.feedback || '')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async () => {
    if (rating === 0) {
      toast({
        title: 'Error',
        description: 'Please select a rating',
        variant: 'destructive',
      })
      return
    }

    setIsSubmitting(true)
    try {
      const response = await fetch(`/api/tickets/${ticketId}/rating`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating, feedback: feedback || null }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to submit rating')
      }

      toast({
        title: 'Thank you!',
        description: 'Your feedback has been submitted successfully.',
      })

      if (onRatingSubmitted) {
        onRatingSubmitted()
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  if (existingRating) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Your Rating</CardTitle>
          <CardDescription>Thank you for your feedback!</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-1 mb-4">
            {[1, 2, 3, 4, 5].map((star) => (
              <Star
                key={star}
                className={`h-6 w-6 ${
                  star <= rating
                    ? 'fill-yellow-400 text-yellow-400'
                    : 'text-gray-300'
                }`}
              />
            ))}
            <span className="ml-2 text-sm text-muted-foreground">
              {rating} out of 5
            </span>
          </div>
          {existingRating.feedback && (
            <div className="mt-4">
              <p className="text-sm font-medium mb-1">Your Feedback:</p>
              <p className="text-sm text-muted-foreground">{existingRating.feedback}</p>
            </div>
          )}
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Rate Your Experience</CardTitle>
        <CardDescription>
          How satisfied were you with the support you received?
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              onClick={() => setRating(star)}
              onMouseEnter={() => setHoveredRating(star)}
              onMouseLeave={() => setHoveredRating(0)}
              className="focus:outline-none"
            >
              <Star
                className={`h-8 w-8 transition-colors ${
                  star <= (hoveredRating || rating)
                    ? 'fill-yellow-400 text-yellow-400'
                    : 'text-gray-300 hover:text-yellow-300'
                }`}
              />
            </button>
          ))}
          <span className="ml-2 text-sm text-muted-foreground">
            {rating > 0 ? `${rating} out of 5` : 'Select a rating'}
          </span>
        </div>
        <div>
          <label className="text-sm font-medium mb-2 block">
            Additional Feedback (Optional)
          </label>
          <Textarea
            placeholder="Tell us more about your experience..."
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={4}
          />
        </div>
        <Button onClick={handleSubmit} disabled={isSubmitting || rating === 0}>
          {isSubmitting ? 'Submitting...' : 'Submit Rating'}
        </Button>
      </CardContent>
    </Card>
  )
}

