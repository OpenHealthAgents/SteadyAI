package com.steadyai.data.user.repository

import com.steadyai.core.model.ApiStatus
import com.steadyai.core.network.api.ApiService
import com.steadyai.core.network.client.ApiClient
import com.steadyai.core.network.model.ApiResult
import io.mockk.coEvery
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test
import retrofit2.Response

class UserRepositoryImplTest {

    private val apiService: ApiService = mockk()
    private val apiClient: ApiClient = mockk()
    private val repository = UserRepositoryImpl(apiService, apiClient)

    @Test
    fun `getApiHealthStatus should return status on success`() = runTest {
        // Given
        val status = ApiStatus("UP")
        val successResult = ApiResult.Success(status, 200)
        
        // We need to mock the apiClient.execute call. 
        // Since it takes a lambda, we use matchers or just coEvery with any()
        coEvery { apiClient.execute<ApiStatus>(any()) } returns successResult

        // When
        val result = repository.getApiHealthStatus()

        // Then
        assertEquals("UP", result)
    }

    @Test(expected = IllegalStateException::class)
    fun `getApiHealthStatus should throw on failure`() = runTest {
        // Given
        val failureResult = ApiResult.Failure(
            com.steadyai.core.network.model.ApiError(
                com.steadyai.core.network.model.ApiErrorType.NETWORK,
                "No connection"
            )
        )
        coEvery { apiClient.execute<ApiStatus>(any()) } returns failureResult

        // When
        repository.getApiHealthStatus()
        
        // Then (Expected exception)
    }
}
