import BookCard from '@/components/Bookcard'
import HeroSection from '@/components/HeroSection'
import { getAllBooks } from '@/lib/actions/book.actions'
import { sampleBooks } from '@/lib/constants'





const page = async () => {

  const bookResults = await getAllBooks()
  const books = bookResults.success ? bookResults.data ?? [] : []

  return (
    <main className="wrapper container pt-28 mb-10 md:mb-16">
      <HeroSection />

      <div className="library-books-grid">
        {/* {sampleBooks.map((book) => (
          <BookCard
            key={book._id}
            title={book.title}
            author={book.author}
            coverURL={book.coverURL}
            slug={book.slug}
          />
        ))} */}

        {books.map((book) => (
          <BookCard
            key={book._id}
            title={book.title}
            author={book.author}
            coverURL={book.coverURL}
            slug={book.slug}
          />
        ))}
      </div>
    </main>
  )
}

export default page
