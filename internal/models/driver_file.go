package models

// DriverFile is a lightweight alias for driver records stored in file_metadata.
// Keeping it as its own type allows future API expansion without introducing a
// separate database table in the core infrastructure phase.
type DriverFile struct {
    FileMetadata
}
