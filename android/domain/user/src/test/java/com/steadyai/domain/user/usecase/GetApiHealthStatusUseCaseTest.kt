package com.steadyai.domain.user.usecase

import com.steadyai.domain.user.repository.UserRepository
import io.mockk.coEvery
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class GetApiHealthStatusUseCaseTest {

    private val userRepository: UserRepository = mockk()
    private val useCase = GetApiHealthStatusUseCase(userRepository)

    @Test
    fun `invoke should return health status from repository`() = runTest {
        // Given
        val expectedStatus = "OK"
        coEvery { userRepository.getApiHealthStatus() } returns expectedStatus

        // When
        val actualStatus = useCase()

        // Then
        assertEquals(expectedStatus, actualStatus)
    }
}
