import { useState } from 'react'
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
        },
      })

      setAuth(user, tokens.access_token)

      if (user.onboarding_complete) {
        router.replace('/')
      } else {
        router.replace('/onboarding')
      }
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <View className="flex-1 bg-black px-6 justify-center">
      <Text className="text-white text-4xl font-bold mb-2">
        Protocol
      </Text>

      <Text className="text-zinc-500 mb-10">
        Your performance operating system
      </Text>

      <TextInput
        value={email}
        onChangeText={setEmail}
        placeholder="Email"
        placeholderTextColor="#71717a"
        autoCapitalize="none"
        className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-4 text-white mb-4"
      />

      <TextInput
        value={password}
        onChangeText={setPassword}
        placeholder="Password"
        placeholderTextColor="#71717a"
        secureTextEntry
        className="bg-zinc-900 border border-zinc-800 rounded-2xl px-4 py-4 text-white mb-4"
      />

      {error && (
        <View className="bg-red-950 border border-red-900 rounded-xl px-4 py-3 mb-4">
          <Text className="text-red-400">{error}</Text>
        </View>
      )}

      <TouchableOpacity
        onPress={handleLogin}
        disabled={loading}
        className="bg-white rounded-2xl py-4 items-center"
      >
        {loading ? (
          <ActivityIndicator color="black" />
        ) : (
          <Text className="text-black font-semibold text-base">
            Sign In
          </Text>
        )}
      </TouchableOpacity>
    </View>
  )
}