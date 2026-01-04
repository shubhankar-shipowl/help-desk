'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { 
  Mail, Lock, Eye, EyeOff, ArrowRight, Shield, Zap, Users,
  AlertCircle
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useToast } from '@/components/ui/use-toast'
import Link from 'next/link'

export default function SignInPage() {
  const router = useRouter()
  const { toast } = useToast()
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [rememberMe, setRememberMe] = useState(false)
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  })
  const [errors, setErrors] = useState({
    email: '',
    password: '',
    general: '',
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setErrors({ email: '', password: '', general: '' })

    // Validate email
    if (!formData.email) {
      setErrors(prev => ({ ...prev, email: 'Email is required' }))
      setIsLoading(false)
      return
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      setErrors(prev => ({ ...prev, email: 'Invalid email format' }))
      setIsLoading(false)
      return
    }

    // Validate password
    if (!formData.password) {
      setErrors(prev => ({ ...prev, password: 'Password is required' }))
      setIsLoading(false)
      return
    }

    try {
      const result = await signIn('credentials', {
        email: formData.email,
        password: formData.password,
        redirect: false,
      })

      if (result?.error) {
        setErrors(prev => ({ 
          ...prev, 
          general: 'Invalid email or password' 
        }))
        toast({
          title: 'Error',
          description: 'Invalid email or password',
          variant: 'destructive',
        })
      } else {
        // Redirect based on role (handled by middleware)
        router.push('/')
        router.refresh()
      }
    } catch (error: any) {
      setErrors(prev => ({ 
        ...prev, 
        general: error.message || 'Something went wrong. Please try again.' 
      }))
      toast({
        title: 'Error',
        description: error.message || 'Something went wrong. Please try again.',
        variant: 'destructive',
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex">
      {/* Left Side - Branding & Features */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-600 relative overflow-hidden">
        {/* Animated Background Shapes */}
        <div className="absolute inset-0 opacity-20">
          <div className="absolute top-20 left-20 w-72 h-72 bg-white rounded-full blur-3xl animate-pulse" />
          <div className="absolute bottom-20 right-20 w-96 h-96 bg-white rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
        </div>

        {/* Content */}
        <div className="relative z-10 flex flex-col justify-center px-16 py-12 text-white">
          {/* Logo */}
          <div className="mb-12">
            <div className="inline-flex items-center gap-3 mb-6">
              <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center shadow-lg">
                <span className="text-2xl font-bold text-indigo-600">S</span>
              </div>
              <span className="text-3xl font-bold">Shipowl Support</span>
            </div>
            <h1 className="text-5xl font-bold mb-4 leading-tight">
              Welcome to Your<br />Support Portal
            </h1>
            <p className="text-xl text-indigo-100">
              Manage tickets, chat with customers, and provide exceptional support.
            </p>
          </div>

          {/* Features */}
          <div className="space-y-6">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-12 h-12 bg-white/20 backdrop-blur-sm rounded-xl flex items-center justify-center">
                <Zap className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-semibold mb-1">Lightning Fast</h3>
                <p className="text-indigo-100">Real-time notifications and instant ticket updates</p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-12 h-12 bg-white/20 backdrop-blur-sm rounded-xl flex items-center justify-center">
                <Shield className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-semibold mb-1">Secure & Private</h3>
                <p className="text-indigo-100">Enterprise-grade security for your data</p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-12 h-12 bg-white/20 backdrop-blur-sm rounded-xl flex items-center justify-center">
                <Users className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-semibold mb-1">Team Collaboration</h3>
                <p className="text-indigo-100">Work together seamlessly with your team</p>
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="mt-12 grid grid-cols-3 gap-8">
            <div>
              <div className="text-4xl font-bold mb-1">10K+</div>
              <div className="text-indigo-100 text-sm">Tickets Resolved</div>
            </div>
            <div>
              <div className="text-4xl font-bold mb-1">500+</div>
              <div className="text-indigo-100 text-sm">Happy Customers</div>
            </div>
            <div>
              <div className="text-4xl font-bold mb-1">98%</div>
              <div className="text-indigo-100 text-sm">Satisfaction Rate</div>
            </div>
          </div>
        </div>
      </div>

      {/* Right Side - Login Form */}
      <div className="flex-1 flex items-center justify-center px-4 sm:px-6 lg:px-8 bg-gray-50">
        <div className="w-full max-w-md">
          {/* Mobile Logo */}
          <div className="lg:hidden mb-8 text-center">
            <div className="inline-flex items-center gap-2 mb-2">
              <div className="w-10 h-10 bg-gradient-to-br from-indigo-600 to-purple-600 rounded-lg flex items-center justify-center shadow-lg">
                <span className="text-xl font-bold text-white">S</span>
              </div>
              <span className="text-2xl font-bold text-gray-900">Shipowl Support</span>
            </div>
          </div>

          {/* Login Card */}
          <div className="bg-white rounded-3xl shadow-2xl border border-gray-100 p-8 sm:p-10">
            {/* Header */}
            <div className="mb-8">
              <h2 className="text-3xl font-bold text-gray-900 mb-2">
                Staff Sign In
              </h2>
              <p className="text-gray-600">
                For administrators and support agents only. Customers can submit tickets without an account.
              </p>
            </div>

            {/* Error Message */}
            {errors.general && (
              <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3">
                <div className="flex-shrink-0 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center">
                  <AlertCircle className="w-3 h-3 text-white" />
                </div>
                <p className="text-sm text-red-800">{errors.general}</p>
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Email Field */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Email Address
                </label>
                <div className="relative">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
                    <Mail className="w-5 h-5" />
                  </div>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="name@company.com"
                    className={cn(
                      "w-full pl-12 pr-4 py-3.5 rounded-xl border-2 transition-all duration-200",
                      "focus:outline-none focus:ring-4 focus:ring-indigo-100",
                      errors.email
                        ? "border-red-300 bg-red-50"
                        : "border-gray-200 hover:border-gray-300 focus:border-indigo-500"
                    )}
                    disabled={isLoading}
                  />
                </div>
                {errors.email && (
                  <p className="mt-2 text-sm text-red-600">{errors.email}</p>
                )}
              </div>

              {/* Password Field */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Password
                </label>
                <div className="relative">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
                    <Lock className="w-5 h-5" />
                  </div>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    placeholder="Enter your password"
                    className={cn(
                      "w-full pl-12 pr-12 py-3.5 rounded-xl border-2 transition-all duration-200",
                      "focus:outline-none focus:ring-4 focus:ring-indigo-100",
                      errors.password
                        ? "border-red-300 bg-red-50"
                        : "border-gray-200 hover:border-gray-300 focus:border-indigo-500"
                    )}
                    disabled={isLoading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                    disabled={isLoading}
                  >
                    {showPassword ? (
                      <EyeOff className="w-5 h-5" />
                    ) : (
                      <Eye className="w-5 h-5" />
                    )}
                  </button>
                </div>
                {errors.password && (
                  <p className="mt-2 text-sm text-red-600">{errors.password}</p>
                )}
              </div>

              {/* Remember Me */}
              <div className="flex items-center">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 focus:ring-2"
                    disabled={isLoading}
                  />
                  <span className="text-sm text-gray-700">Remember me</span>
                </label>
              </div>

              {/* Sign In Button */}
              <button
                type="submit"
                disabled={isLoading}
                className={cn(
                  "w-full py-3.5 rounded-xl font-semibold text-white transition-all duration-200",
                  "focus:outline-none focus:ring-4 focus:ring-indigo-300",
                  "flex items-center justify-center gap-2",
                  isLoading
                    ? "bg-gray-400 cursor-not-allowed"
                    : "bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 shadow-lg hover:shadow-xl hover:-translate-y-0.5"
                )}
              >
                {isLoading ? (
                  <>
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Signing In...
                  </>
                ) : (
                  <>
                    Sign In
                    <ArrowRight className="w-5 h-5" />
                  </>
                )}
              </button>
            </form>

            {/* Footer */}
            <p className="mt-8 text-center text-sm text-gray-600">
              Customer looking for support?{' '}
              <Link href="/tickets/new" className="font-medium text-indigo-600 hover:text-indigo-700">
                Submit a ticket
              </Link>
            </p>
          </div>

          {/* Security Badge */}
          <div className="mt-6 flex items-center justify-center gap-2 text-sm text-gray-500">
            <Shield className="w-4 h-4" />
            <span>Secured by 256-bit SSL encryption</span>
          </div>
        </div>
      </div>
    </div>
  )
}
