import axios from 'axios';  // You'll need to npm install axios first

async function testRequest(): Promise<any> {
  console.log('Starting test request...');

  try {
    const response = await axios.get('https://jsonplaceholder.typicode.com/posts/1', {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    console.log('Response status:', response.status);
    console.log('Request completed');
    return response.data;

  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error('Axios error:', {
        message: error.message,
        code: error.code,
        status: error.response?.status
      });
    } else {
      console.error('Unexpected error:', error);
    }
    throw error;
  }
}

// Test
console.log('Before test request');
testRequest()
  .then(result => console.log('Success:', result))
  .catch(error => console.error('Error:', error));
console.log('After test request');